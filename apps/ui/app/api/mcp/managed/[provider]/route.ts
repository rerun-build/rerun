import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { brandTools } from '@/lib/brand/text'
import { workspaceBrand } from '@/lib/brand/workspace'
import { getManagedProvider } from '@/lib/managed/registry'
import { getTool, toolDefs } from '@/lib/managed/types'

// A managed provider's MCP server, hosted by the UI — the "interface" an agent's tool points
// at instead of the third party. A tiny stateless JSON-RPC 2.0 handler for the four
// methods the engine's MCP http client uses. Rerun runs the provider's
// API calls server-side.
//
// Auth model: the engine authenticates via `x-rerun-key` (its RERUN_API_KEY → workspace). The
// third-party access token rides in `Authorization: Bearer`, injected by the engine's withAuth
// from its own token store — Rerun uses it for this one call and never persists it.
export const dynamic = 'force-dynamic'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

function rpcResult(id: unknown, result: unknown): Response {
    return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: unknown, code: number, message: string): Response {
    return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
    const { provider: providerId } = await params
    const provider = getManagedProvider(providerId)
    if (!provider) return new Response('Unknown provider', { status: 404 })

    const engineKey = req.headers.get('x-rerun-key') ?? ''
    const engine = await authenticateEngineToken(engineKey)
    if (!engine) {
        console.warn('[managed] rejected request with invalid/absent engine key')
        return new Response('Unauthorized', { status: 401 })
    }

    let rpc: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
    try {
        rpc = await req.json()
    } catch {
        return rpcError(null, -32700, 'Parse error')
    }

    const { method, id, params: rpcParams } = rpc

    if (typeof method === 'string' && method.startsWith('notifications/')) {
        return new Response(null, { status: 202 })
    }

    if (method === 'initialize') {
        const requested = rpcParams?.protocolVersion
        const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION
        return rpcResult(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: `rerun-managed-${provider.id}`, version: '1.0.0' },
        })
    }

    if (method === 'tools/list') {
        return rpcResult(id, { tools: brandTools(toolDefs(provider), await workspaceBrand(engine.workspaceId)) })
    }

    if (method === 'tools/call') {
        const authHeader = req.headers.get('authorization') ?? ''
        const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (!accessToken) {
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: `${provider.label} is not connected. Ask the user to connect it.` }) }], isError: true })
        }
        const name = typeof rpcParams?.name === 'string' ? rpcParams.name : ''
        const tool = getTool(provider, name)
        if (!tool) return rpcError(id, -32601, `Unknown tool: ${name}`)
        const args = (rpcParams?.arguments ?? {}) as Record<string, unknown>
        try {
            const out = await tool.execute(args, accessToken)
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Tool failed'
            console.error(`[managed:${provider.id}] tools/call ${name} failed:`, message)
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true })
        }
    }

    return rpcError(id, -32601, `Method not found: ${method}`)
}
