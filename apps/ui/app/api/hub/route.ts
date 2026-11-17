import { memberActor, workspaceActor, type Actor } from '@/app/api/_auth/access'
import { FOREMAN_AGENT_ID, FOREMAN_HUB_TOKEN_HEADER } from '@rerun/contracts'

import { isAiStatusHubTool, readRerunCredit } from '@/app/api/_services/ai-status-hub.service'
import { dispatchForemanHubTool } from '@/app/api/_services/foreman-hub.service'
import { COWORKER_HUB_TOOLS, dispatchHubTool } from '@/app/api/_services/services.service'
import { foremanAgentId } from '@/lib/foreman/agent-row'
import { dispatchTeamHubTool, isTeamHubTool } from '@/app/api/_services/team-hub.service'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { foremanHubTokenRequired, verifyForemanHubToken } from '@/lib/foreman/hub-token'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// Rerun Hub REST endpoint. The engine's built-in `rerun_hub_*` tools call this over
// the public internet, authenticated with its RERUN_API_KEY (same identity as the engine
// webhooks), which names one workspace. The `x-rerun-agent` header carries the ENGINE agent
// id, resolved here to the Supabase agent of that workspace. Every coworker of the box holds that
// key, so `foreman` must also carry the token the hub signed into the foreman's brief.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const engine = await authenticateEngineToken(token)
    if (!engine) {
        console.warn('[hub] rejected request with invalid/absent engine key')
        return new Response('Unauthorized', { status: 401 })
    }

    const engineAgentId = req.headers.get('x-rerun-agent') ?? ''
    if (!engineAgentId) return new Response('Missing x-rerun-agent header', { status: 400 })

    // The foreman speaks for the member its signed token names, or the whole workspace without one.
    const isForeman = engineAgentId === FOREMAN_AGENT_ID
    // The person the foreman's turn speaks for, from its signed token: their access, not the
    // workspace's. A token without one (minted before, or no token at all) acts as the workspace.
    let foremanActor: Actor = workspaceActor(engine.workspaceId)
    if (isForeman) {
        const foremanToken = req.headers.get(FOREMAN_HUB_TOKEN_HEADER)
        if (foremanToken) {
            const claims = verifyForemanHubToken(foremanToken, engine.workspaceId)
            if (!claims) return new Response('Invalid foreman token', { status: 403 })
            if (claims.uid) {
                const member = await memberActor(engine.workspaceId, claims.uid)
                if (!member) return new Response('The member this foreman speaks for has left the workspace', { status: 403 })
                foremanActor = member
            }
        } else if (foremanHubTokenRequired()) {
            return new Response('Missing foreman token', { status: 403 })
        } else {
            console.warn('[hub] foreman call without token (tolerated)', { workspaceId: engine.workspaceId })
        }
    }
    const supabase = createServiceRoleClient()
    const { data: agent } = isForeman ? { data: null } : await selectMaybeSingle(supabase, 'agents', ['id'] as const, { engine_agent_id: engineAgentId, workspace_id: engine.workspaceId })
    if (!isForeman && !agent) return new Response('Coworker does not belong to the authenticated workspace', { status: 403 })

    let body: { tool?: string; args?: Record<string, unknown> }
    try {
        body = await req.json()
    } catch {
        return new Response('Invalid JSON', { status: 400 })
    }

    const tool = typeof body.tool === 'string' ? body.tool : ''
    const args = (body.args ?? {}) as Record<string, unknown>
    if (!tool) return new Response('Missing tool', { status: 400 })

    try {
        // The account tools of its brief stay the foreman's own; the tools it shares with every
        // coworker run on its row of `agents`, under the rights of the member it talks to.
        const out = !agent
            ? isForeman && COWORKER_HUB_TOOLS.has(tool) && tool !== 'search_docs'
                ? await dispatchHubTool(await foremanAgentId(engine.workspaceId), tool, args, engine.workspaceId, foremanActor)
                : await dispatchForemanHubTool(foremanActor, tool, args)
            : isTeamHubTool(tool)
              ? await dispatchTeamHubTool(agent.id, engine.workspaceId, tool, args)
              : isAiStatusHubTool(tool)
                ? await readRerunCredit(engine.workspaceId)
                : await dispatchHubTool(agent.id, tool, args, engine.workspaceId)
        return Response.json(out)
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Hub tool failed'
        console.error(`[hub] ${tool} failed:`, message)
        return Response.json({ error: message })
    }
}
