import { SERVICE_INSTANCE_ID_RE, serviceRegistryKey } from '@rerun/contracts'
import { loadManifest } from '@/app/api/_services/services.service'
import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { ComposioApiError, composioUserId, executeTool, listToolkitTools } from '@/lib/composio/client'
import { readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { getVaultItem, patchVaultItem } from '@/lib/engine/vault-client'
import { composioVaultUserId } from '@/lib/vault/composio'
import type { VaultItemSummary } from '@rerun/contracts'
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

// A coworker gets the app's tools as soon as it is installed, before the user connects the account
// behind it, so "not connected" is more often a first connection than a lost one: only an active
// entry was ever connected. That one goes back to needs_auth, so the Services tab shows Reconnect
// instead of a silently broken connector. Failures are logged, never surfaced to the agent.
async function settleNotConnected(workspaceId: number, engineAgentId: string, key: string): Promise<'never' | 'lost'> {
    try {
        const conn = await getWorkspaceConnection(workspaceId)
        const entry = (await readRegistry(conn, engineAgentId)).services[key]
        if (!entry?.composio || entry.status !== 'active') return 'never'
        const composio = { toolkit: entry.composio.toolkit, serverName: entry.composio.serverName }
        await upsertRegistryEntry(conn, engineAgentId, key, { ...entry, status: 'needs_auth', composio })
        return 'lost'
    } catch (err) {
        console.warn(`[composio:${key}] could not read or flag the registry entry:`, err instanceof Error ? err.message : err)
        return 'never'
    }
}

function notConnectedMessage(name: string, slug: string, connection: 'never' | 'lost'): string {
    const situation = connection === 'never' ? `${name} is not connected yet.` : `${name}'s connection expired or was revoked.`
    return `${situation} Call suggest_service with slug "${slug}" so the user gets a Connect card, then end your turn.`
}

// suggest_service only knows catalog slugs, so the agent is pointed at the app, not the account.
async function notConnectedResponse(id: unknown, ctx: { workspaceId: number; engineAgentId: string; slug: string; instanceId?: string; name: string; tool: string; rawMessage: string }): Promise<Response> {
    const key = serviceRegistryKey(ctx.slug, ctx.instanceId)
    const connection = await settleNotConnected(ctx.workspaceId, ctx.engineAgentId, key)
    console.warn(`[composio:${key}] tools/call ${ctx.tool}: not connected (${connection}):`, ctx.rawMessage)
    return toolError(id, notConnectedMessage(ctx.name, ctx.slug, connection))
}

// The entry behind a server of the Vault, read off the box of the authenticated workspace: the right
// app, and held by the coworker calling.
async function vaultEntryFor(workspaceId: number, itemId: string, engineAgentId: string, toolkit: string): Promise<VaultItemSummary | null> {
    try {
        const item = await getVaultItem(await getWorkspaceConnection(workspaceId), itemId)
        const holds = item.sharedWithAll || item.agentIds.includes(engineAgentId)
        return holds && item.composio?.toolkit === toolkit ? item : null
    } catch {
        return null
    }
}

// An entry that was connected and no longer answers goes back to needs_auth, for every coworker
// using it: the Vault shows it to reconnect.
async function vaultNotConnected(id: unknown, workspaceId: number, item: VaultItemSummary, slug: string, name: string): Promise<Response> {
    const lost = item.status === 'active'
    if (lost) await patchVaultItem(await getWorkspaceConnection(workspaceId), item.id, { status: 'needs_auth' }).catch(() => {})
    return toolError(id, notConnectedMessage(name, slug, lost ? 'lost' : 'never'))
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

        // A server of a Vault entry acts as the entry's account, once the calling coworker is proven to
        // hold it. The header is the engine's own: a server a coworker wrote itself never carries one.
        const vaultItemId = req.headers.get('x-rerun-vault-item')
        let vaultItem: VaultItemSummary | null = null
        if (vaultItemId) {
            vaultItem = await vaultEntryFor(engine.workspaceId, vaultItemId, engineAgentId, toolkit)
            if (!vaultItem) return rpcError(id, -32603, 'This coworker does not hold that Vault entry')
        }
        const userId = vaultItem ? await composioVaultUserId(engine.workspaceId, vaultItem) : composioUserId(agent.id, instanceId)

        try {
            const out = await executeTool(name, userId, args)
            if (!out.successful) {
                const message = out.error ?? 'Tool failed'
                if (isNotConnectedError(message)) {
                    if (vaultItem) return vaultNotConnected(id, engine.workspaceId, vaultItem, slug, manifest.name)
                    return notConnectedResponse(id, { workspaceId: engine.workspaceId, engineAgentId, slug, instanceId, name: manifest.name, tool: name, rawMessage: message })
                }
                return toolError(id, message)
            }
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out.data) }], structuredContent: out.data })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool failed'
            // Order matters: Composio reports a missing connected account as a 404 too, so the
            // not-connected check must run before the 404 → unknown-tool mapping.
            if (isNotConnectedError(message)) {
                if (vaultItem) return vaultNotConnected(id, engine.workspaceId, vaultItem, slug, manifest.name)
                return notConnectedResponse(id, { workspaceId: engine.workspaceId, engineAgentId, slug, instanceId, name: manifest.name, tool: name, rawMessage: message })
            }
            if (err instanceof ComposioApiError && err.status === 404) return rpcError(id, -32601, `Unknown tool: ${name}`)
            console.error(`[composio:${slug}] tools/call ${name} failed:`, message)
            return toolError(id, `${manifest.name} is temporarily unavailable. Try again later.`)
        }
    }

    return rpcError(id, -32601, `Method not found: ${rpcMethod}`)
}
