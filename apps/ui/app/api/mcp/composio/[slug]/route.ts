import { SERVICE_INSTANCE_ID_RE, serviceRegistryKey } from '@rerun/contracts'
import { loadManifest } from '@/app/api/_services/services.service'
import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { ComposioApiError, composioUserId, deleteConnectedAccount, executeTool, listToolkitTools } from '@/lib/composio/client'
import { readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// A Composio service's MCP server, hosted by the UI — sibling of /api/mcp/managed/<provider>,
// but the third-party token never exists on our side at all: Composio holds it, and every
// tools/call is forwarded to Composio scoped by a per-agent user_id.
//
// Auth model: the engine authenticates via `x-rerun-key` (its RERUN_API_KEY → space), and
// `x-rerun-agent` (the ENGINE agent id) is resolved to the Supabase agent WITHIN that workspace —
// so the user_id is derived server-side and a box can never reach another workspace's
// connections, even with a forged header. The COMPOSIO_API_KEY stays on this server.
// An extra account of the app is compiled with `x-rerun-instance: <instanceId>`, which picks its
// own user_id, so each account of one coworker reaches its own connected account.
export const dynamic = 'force-dynamic'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

function rpcResult(id: unknown, result: unknown): Response {
    return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: unknown, code: number, message: string): Response {
    return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolError(id: unknown, message: string): Response {
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true })
}

function isNotConnectedError(message: string): boolean {
    return /connected account|no connection|not connected|inactive|expired/i.test(message)
}

// Google's answer when the token lacks the permission the tool needs: the account is connected, but
// the user left that box unticked on the consent screen, or an admin blocks it.
function isMissingScopeError(message: string): boolean {
    return /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)
}

// A coworker gets the app's tools as soon as it is installed, before the user connects the account
// behind it, so "not connected" is more often a first connection than a lost one: only an active
// entry was ever connected. That one goes back to needs_auth, so the Services tab shows Reconnect
// instead of a silently broken connector. Failures are logged, never surfaced to the agent.
// A lost entry also hands back the account it was bound to, which the registry no longer remembers.
async function settleNotConnected(workspaceId: number, engineAgentId: string, key: string): Promise<{ connection: 'never' | 'lost'; connectedAccountId?: string }> {
    try {
        const conn = await getWorkspaceConnection(workspaceId)
        const entry = (await readRegistry(conn, engineAgentId)).services[key]
        if (!entry?.composio || entry.status !== 'active') return { connection: 'never' }
        const composio = { toolkit: entry.composio.toolkit, serverName: entry.composio.serverName }
        await upsertRegistryEntry(conn, engineAgentId, key, { ...entry, status: 'needs_auth', composio })
        return { connection: 'lost', connectedAccountId: entry.composio.connectedAccountId }
    } catch (err) {
        console.warn(`[composio:${key}] could not read or flag the registry entry:`, err instanceof Error ? err.message : err)
        return { connection: 'never' }
    }
}

function notConnectedMessage(name: string, slug: string, connection: 'never' | 'lost'): string {
    const situation = connection === 'never' ? `${name} is not connected yet.` : `${name}'s connection expired or was revoked.`
    return `${situation} Call suggest_service with slug "${slug}" so the user gets a Connect card, then end your turn.`
}

type ToolCallContext = { workspaceId: number; engineAgentId: string; slug: string; instanceId?: string; name: string; tool: string; rawMessage: string }

// suggest_service only knows catalog slugs, so the agent is pointed at the app, not the account.
async function notConnectedResponse(id: unknown, ctx: ToolCallContext): Promise<Response> {
    const key = serviceRegistryKey(ctx.slug, ctx.instanceId)
    const { connection } = await settleNotConnected(ctx.workspaceId, ctx.engineAgentId, key)
    console.warn(`[composio:${key}] tools/call ${ctx.tool}: not connected (${connection}):`, ctx.rawMessage)
    return toolError(id, notConnectedMessage(ctx.name, ctx.slug, connection))
}

// Composio picks the account by user_id alone: left ACTIVE, this one could answer again after the reconnect.
async function missingScopeResponse(id: unknown, ctx: ToolCallContext): Promise<Response> {
    const key = serviceRegistryKey(ctx.slug, ctx.instanceId)
    const { connectedAccountId } = await settleNotConnected(ctx.workspaceId, ctx.engineAgentId, key)
    if (connectedAccountId) {
        await deleteConnectedAccount(connectedAccountId).catch(err => {
            console.warn(`[composio:${key}] could not delete connected account ${connectedAccountId}:`, err instanceof Error ? err.message : err)
        })
    }
    console.warn(`[composio:${key}] tools/call ${ctx.tool}: scope not granted:`, ctx.rawMessage)
    return toolError(id, `${ctx.name} is connected without the permission this needs. Call suggest_service with slug "${ctx.slug}" so the user connects it again and grants it, then end your turn.`)
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
    const { slug } = await params

    const engineKey = req.headers.get('x-rerun-key') ?? ''
    const engine = await authenticateEngineToken(engineKey)
    if (!engine) {
        console.warn('[composio] rejected request with invalid/absent engine key')
        return new Response('Unauthorized', { status: 401 })
    }

    // A malformed id must not fall back to the base account: that would act as the wrong mailbox.
    const instanceHeader = req.headers.get('x-rerun-instance')
    if (instanceHeader && !SERVICE_INSTANCE_ID_RE.test(instanceHeader)) return new Response('Invalid x-rerun-instance', { status: 400 })
    const instanceId = instanceHeader || undefined

    const manifest = await loadManifest(slug)
    const method = manifest?.authMethods.find(m => m.kind === 'composio' && m.composio)
    if (!manifest || !method?.composio) return new Response('Unknown Composio service', { status: 404 })
    const { toolkit, allowedTools } = method.composio

    let rpc: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
    try {
        rpc = await req.json()
    } catch {
        return rpcError(null, -32700, 'Parse error')
    }

    const { method: rpcMethod, id, params: rpcParams } = rpc

    if (typeof rpcMethod === 'string' && rpcMethod.startsWith('notifications/')) {
        return new Response(null, { status: 202 })
    }

    if (rpcMethod === 'initialize') {
        const requested = rpcParams?.protocolVersion
        const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
        return rpcResult(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: `rerun-composio-${slug}`, version: '1.0.0' },
        })
    }

    if (rpcMethod === 'tools/list') {
        try {
            const tools = await listToolkitTools(toolkit)
            const allowed = allowedTools?.length ? tools.filter(t => allowedTools.includes(t.slug)) : tools
            if (allowedTools?.length && allowed.length === 0) console.warn(`[composio:${slug}] allowedTools filtered out every ${toolkit} tool`)
            return rpcResult(id, { tools: allowed.map(t => ({ name: t.slug, description: t.description, inputSchema: t.inputParameters })) })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Composio is unavailable'
            console.error(`[composio:${slug}] tools/list failed:`, message)
            return rpcError(id, -32000, `${manifest.name} tools are temporarily unavailable.`)
        }
    }

    if (rpcMethod === 'tools/call') {
        const name = typeof rpcParams?.name === 'string' ? rpcParams.name : ''
        if (allowedTools?.length && !allowedTools.includes(name)) return rpcError(id, -32601, `Unknown tool: ${name}`)
        const args = (rpcParams?.arguments ?? {}) as Record<string, unknown>

        const engineAgentId = req.headers.get('x-rerun-agent') ?? ''
        const supabase = createServiceRoleClient()
        const { data: agent } = engineAgentId ? await selectMaybeSingle(supabase, 'agents', ['id'] as const, { engine_agent_id: engineAgentId, workspace_id: engine.workspaceId }) : { data: null }
        if (!agent) return rpcError(id, -32603, 'Coworker does not belong to the authenticated workspace')

        const callContext = (rawMessage: string): ToolCallContext => ({ workspaceId: engine.workspaceId, engineAgentId, slug, instanceId, name: manifest.name, tool: name, rawMessage })
        try {
            const out = await executeTool(name, composioUserId(agent.id, instanceId), args)
            if (!out.successful) {
                const message = out.error ?? 'Tool failed'
                if (isMissingScopeError(message)) return missingScopeResponse(id, callContext(message))
                if (isNotConnectedError(message)) return notConnectedResponse(id, callContext(message))
                return toolError(id, message)
            }
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out.data) }], structuredContent: out.data })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool failed'
            if (isMissingScopeError(message)) return missingScopeResponse(id, callContext(message))
            // Order matters: Composio reports a missing connected account as a 404 too, so the
            // not-connected check must run before the 404 → unknown-tool mapping.
            if (isNotConnectedError(message)) return notConnectedResponse(id, callContext(message))
            if (err instanceof ComposioApiError && err.status === 404) return rpcError(id, -32601, `Unknown tool: ${name}`)
            console.error(`[composio:${slug}] tools/call ${name} failed:`, message)
            return toolError(id, `${manifest.name} is temporarily unavailable. Try again later.`)
        }
    }

    return rpcError(id, -32601, `Method not found: ${rpcMethod}`)
}
