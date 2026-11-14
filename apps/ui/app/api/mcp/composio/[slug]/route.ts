import { SERVICE_INSTANCE_ID_RE, serviceRegistryKey } from '@rerun/contracts'
import { loadManifest } from '@/app/api/_services/services.service'
import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { ComposioApiError, composioUserId, executeTool, listToolkitTools } from '@/lib/composio/client'
import { readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

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

async function notConnectedResponse(id: unknown, ctx: { workspaceId: number; engineAgentId: string; slug: string; instanceId?: string; name: string; tool: string; rawMessage: string }): Promise<Response> {
    const key = serviceRegistryKey(ctx.slug, ctx.instanceId)
    const connection = await settleNotConnected(ctx.workspaceId, ctx.engineAgentId, key)
    console.warn(`[composio:${key}] tools/call ${ctx.tool}: not connected (${connection}):`, ctx.rawMessage)
    return toolError(id, notConnectedMessage(ctx.name, ctx.slug, connection))
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
    const { slug } = await params

    const engineKey = req.headers.get('x-rerun-key') ?? ''
    const engine = await authenticateEngineToken(engineKey)
    if (!engine) {
        console.warn('[composio] rejected request with invalid/absent engine key')
        return new Response('Unauthorized', { status: 401 })
    }

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

        try {
            const out = await executeTool(name, composioUserId(agent.id, instanceId), args)
            if (!out.successful) {
                const message = out.error ?? 'Tool failed'
                if (isNotConnectedError(message)) {
                    return notConnectedResponse(id, { workspaceId: engine.workspaceId, engineAgentId, slug, instanceId, name: manifest.name, tool: name, rawMessage: message })
                }
                return toolError(id, message)
            }
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out.data) }], structuredContent: out.data })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool failed'
            if (isNotConnectedError(message)) {
                return notConnectedResponse(id, { workspaceId: engine.workspaceId, engineAgentId, slug, instanceId, name: manifest.name, tool: name, rawMessage: message })
            }
            if (err instanceof ComposioApiError && err.status === 404) return rpcError(id, -32601, `Unknown tool: ${name}`)
            console.error(`[composio:${slug}] tools/call ${name} failed:`, message)
            return toolError(id, `${manifest.name} is temporarily unavailable. Try again later.`)
        }
    }

    return rpcError(id, -32601, `Method not found: ${rpcMethod}`)
}
