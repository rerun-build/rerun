import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { reportWorkspaceEvent } from '@/lib/apps/analytics'
import { agentConnection, claimQuota, connectionScope, markNeedsReconnect, pauseForRateLimit, updateConnection } from '@/lib/apps/connections'
import { LinkupError, runAction } from '@/lib/apps/linkup/client'
import { appDefinition } from '@/lib/apps/registry'
import { AppToolRefusal, missingRequired, toolParams } from '@/lib/apps/tools'
import { isAppSlug } from '@/lib/apps/types'
import { negotiatedProtocolVersion, rpcError, rpcResult, toolError, toolResult, type RpcRequest } from '@/lib/mcp/hub-rpc'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'

// A paid app's MCP server, hosted by the hub. Same trust model as /api/mcp/composio/<slug>: the
// engine proves its workspace with `x-rerun-key`, names its coworker with `x-rerun-agent`, and the
// account the call acts with is looked up here from that coworker, never taken from the call. The
// Linkup key stays on this server.
export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
    const { slug } = await params
    if (!isAppSlug(slug)) return new Response('Unknown app', { status: 404 })
    const app = appDefinition(slug)

    const engine = await authenticateEngineToken(req.headers.get('x-rerun-key') ?? '')
    if (!engine) return new Response('Unauthorized', { status: 401 })

    let rpc: RpcRequest
    try {
        rpc = await req.json()
    } catch {
        return rpcError(null, -32700, 'Parse error')
    }
    const { method, id, params: rpcParams } = rpc

    if (typeof method === 'string' && method.startsWith('notifications/')) return new Response(null, { status: 202 })

    if (method === 'initialize') {
        return rpcResult(id, { protocolVersion: negotiatedProtocolVersion(rpcParams?.protocolVersion), capabilities: { tools: {} }, serverInfo: { name: `rerun-app-${slug}`, version: '1.0.0' } })
    }

    if (method === 'tools/list') {
        return rpcResult(id, { tools: app.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) })
    }

    if (method !== 'tools/call') return rpcError(id, -32601, `Method not found: ${method}`)

    const toolName = typeof rpcParams?.name === 'string' ? rpcParams.name : ''
    const tool = app.tools.find(candidate => candidate.name === toolName)
    if (!tool) return rpcError(id, -32601, `Unknown tool: ${String(rpcParams?.name)}`)

    const supabase = createServiceRoleClient()
    const engineAgentId = req.headers.get('x-rerun-agent') ?? ''
    const { data: agent } = engineAgentId ? await selectMaybeSingle(supabase, 'agents', ['id'] as const, { engine_agent_id: engineAgentId, workspace_id: engine.workspaceId }) : { data: null }
    if (!agent) return rpcError(id, -32603, 'Coworker does not belong to the authenticated workspace')

    const resolved = await agentConnection(supabase, agent.id, slug)
    if (!resolved.ok) {
        const { data: workspaceAccounts } = await selectCount(supabase, 'app_connections', { workspace_id: engine.workspaceId, app_slug: slug, status: 'connected' })
        const attach = workspaceAccounts
            ? `No ${app.providerLabel} account is attached to you, but the workspace already has one: call suggest_service with ${app.serviceSlug} and the user picks it for you on the card.`
            : `No ${app.providerLabel} account is attached to you: call suggest_service with ${app.serviceSlug} so the user connects one.`
        return toolError(id, app.readWithoutAccount ? `${attach} ${app.readWithoutAccount}` : attach)
    }
    const { connection, appStatus } = resolved
    if (connection.workspace_id !== engine.workspaceId) return rpcError(id, -32603, 'Account does not belong to the authenticated workspace')
    if (appStatus !== 'active') return toolError(id, `${app.name} is paused while the workspace is paused. Nothing was sent.`)

    if (connection.status === 'paused' && connection.pause_reason === 'rate_limited' && connection.paused_until && new Date(connection.paused_until) <= new Date()) {
        await updateConnection(supabase, connection.id, { status: 'connected', pause_reason: null, paused_until: null })
    } else if (connection.status === 'paused') {
        const until = connection.paused_until ? ` until ${new Date(connection.paused_until).toUTCString()}` : ''
        return toolError(id, `This ${app.providerLabel} account is paused${until}${connection.pause_reason === 'rate_limited' ? ` because ${app.providerLabel} asked it to slow down` : ', its slot is not paid for'}. Nothing was sent. Tell the user.`)
    } else if (connection.status !== 'connected') {
        return toolError(id, `This ${app.providerLabel} account needs to be reconnected by the user, from Settings → Apps. Nothing was sent.`)
    }
    if (!connection.provider_account_id) return toolError(id, `This ${app.providerLabel} account is still being connected. Try again in a minute.`)

    const args = (rpcParams?.arguments ?? {}) as Record<string, unknown>
    const linkupParams = toolParams(tool, args)
    const missing = missingRequired(tool, linkupParams)
    if (missing.length > 0) return toolError(id, `Missing ${missing.join(', ')}.`)

    try {
        // The stricter limit is claimed first: refused there, the call has not eaten the other one.
        const extra = await tool.extraQuota?.(connection.provider_account_id, linkupParams)
        const claims = [...(extra ? [{ action: extra, amount: 1 }] : []), ...(tool.quota ? [{ action: tool.quota.action, amount: tool.quota.amount?.(linkupParams) ?? 1 }] : [])]
        for (const claim of claims) {
            const { periods, maxes } = app.quotaClaim(claim.action, new Date())
            if (!(await claimQuota(supabase, connectionScope(connection.id), claim.action, periods, maxes, claim.amount))) {
                await reportWorkspaceEvent(supabase, connection.workspace_id, 'app_quota_hit', { app: slug, action: claim.action })
                return toolError(id, app.quotaRefusal(claim.action))
            }
        }
        const accountId = connection.provider_account_id
        const result = tool.run
            ? await tool.run({ slug, accountId, connectionId: connection.id, engineAgentId, engine: () => getWorkspaceConnection(engine.workspaceId) }, linkupParams)
            : await runAction(accountId, tool.category, tool.action, linkupParams)
        return toolResult(id, result)
    } catch (err) {
        if (err instanceof AppToolRefusal) return toolError(id, err.message)
        if (!(err instanceof LinkupError)) {
            console.error(`[apps:${slug}] ${tool.name} failed`, err)
            return toolError(id, `${app.providerLabel} is unavailable right now. Nothing was sent. Try again later.`)
        }
        if (err.code === 'RATE_LIMITED') {
            await pauseForRateLimit(supabase, connection, slug)
            return toolError(id, `${app.providerLabel} asked this account to slow down. It rests for 24 hours: stop every ${app.providerLabel} action for today and tell the user.`)
        }
        const sessionClosed = app.sessionClosed?.(err) === true
        if (sessionClosed || err.code === 'ACCOUNT_INACTIVE' || err.code === 'INVALID_ACCOUNT') {
            await markNeedsReconnect(supabase, connection, slug, sessionClosed ? 'connection_closed' : err.code.toLowerCase())
            return toolError(id, `This ${app.providerLabel} account was signed out. The user has been asked to reconnect it. Nothing was sent.`)
        }
        if (err.code === 'INVALID_PARAMS' || err.code === 'CHANNEL_ERROR') return toolError(id, `${app.providerLabel} refused: ${err.message}`)
        if (err.code === 'INSUFFICIENT_CREDITS') {
            console.error(`[apps:${slug}] Linkup is out of credits`)
            return toolError(id, `${app.name} is out of credits for this action right now. Nothing was done. Tell the user and try again later.`)
        }
        console.error(`[apps:${slug}] ${tool.name} failed with ${err.code}`, err.message)
        return toolError(id, `${app.providerLabel} is unavailable right now. Nothing was sent. Try again later.`)
    }
}
