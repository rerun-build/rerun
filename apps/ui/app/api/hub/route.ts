import { memberActor, workspaceActor, type Actor } from '@/app/api/_auth/access'
import { FOREMAN_AGENT_ID, FOREMAN_HUB_TOKEN_HEADER, FOREMAN_WAKE_BRIEF_TOOL, foremanWakeRequestSchema } from '@rerun/contracts'

import { isAiStatusHubTool, readRerunCredit } from '@/app/api/_services/ai-status-hub.service'
import { dispatchForemanHubTool } from '@/app/api/_services/foreman-hub.service'
import { dispatchHubTool } from '@/app/api/_services/services.service'
import { dispatchTeamHubTool, isTeamHubTool } from '@/app/api/_services/team-hub.service'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { foremanHubTokenRequired, verifyForemanHubToken } from '@/lib/foreman/hub-token'
import { foremanWakeBrief } from '@/lib/foreman/wake-brief'
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

    let body: { tool?: string; args?: Record<string, unknown> }
    try {
        body = await req.json()
    } catch {
        return new Response('Invalid JSON', { status: 400 })
    }

    const tool = typeof body.tool === 'string' ? body.tool : ''
    const args = (body.args ?? {}) as Record<string, unknown>
    if (!tool) return new Response('Missing tool', { status: 400 })

    // The foreman has no agent row: it speaks for the whole workspace the engine key names.
    const isForeman = engineAgentId === FOREMAN_AGENT_ID

    // The brief of a run the box starts on its own comes before any token: there is none yet, it is
    // what hands one out. What it hands out only reads, so the box's key is enough to ask.
    if (isForeman && tool === FOREMAN_WAKE_BRIEF_TOOL) {
        const request = foremanWakeRequestSchema.safeParse(args)
        if (!request.success) return Response.json({ error: 'Invalid wake request' }, { status: 400 })
        return Response.json(await foremanWakeBrief(engine.workspaceId, request.data))
    }

    // The person the foreman's turn speaks for, from its signed token: their access, not the
    // workspace's. A token without one (minted before, or no token at all) acts as the workspace.
    let foremanActor: Actor = workspaceActor(engine.workspaceId)
    let wake = false
    if (isForeman) {
        const foremanToken = req.headers.get(FOREMAN_HUB_TOKEN_HEADER)
        if (foremanToken) {
            const claims = verifyForemanHubToken(foremanToken, engine.workspaceId)
            if (!claims) return new Response('Invalid foreman token', { status: 403 })
            wake = claims.scope === 'wake'
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

    try {
        const out = !agent
            ? await dispatchForemanHubTool(foremanActor, tool, args, { wake })
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
