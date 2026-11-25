import { memberActor, workspaceActor, type Actor } from '@/app/api/_auth/access'
import { FOREMAN_AGENT_ID, FOREMAN_HUB_TOKEN_HEADER } from '@rerun/contracts'

import { isAiStatusHubTool, readRerunCredit } from '@/app/api/_services/ai-status-hub.service'
import { dispatchForemanHubTool } from '@/app/api/_services/foreman-hub.service'
import { dispatchHubTool } from '@/app/api/_services/services.service'
import { dispatchTeamHubTool, isTeamHubTool } from '@/app/api/_services/team-hub.service'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { brandText } from '@/lib/brand/text'
import { workspaceBrand } from '@/lib/brand/workspace'
import { FOREMAN_READ_TOOL_NAMES } from '@/lib/foreman/engine-brief'
import { foremanHubTokenRequired, verifyForemanHubToken } from '@/lib/foreman/hub-token'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// Rerun Hub REST endpoint. The engine's built-in `rerun_hub_*` tools call this over
// the public internet, authenticated with its RERUN_API_KEY (same identity as the engine
// webhooks), which names one workspace. The `x-rerun-agent` header carries the ENGINE agent
// id, resolved here to the Supabase agent of that workspace. Every coworker of the box holds that
// key, so `foreman` must also carry the token the hub signed into the foreman's brief.
export const dynamic = 'force-dynamic'

// The foreman's own coworker tools: it reads the team, the credit and the catalog and installs on
// itself exactly as a coworker of the box does, so these need no token. That is what lets a routine
// or a webhook run of the foreman, which carries no brief and so no token, still reach them, as the
// workspace. A turn whose token names a member still acts with that member's access. Its published
// files belong to its agent row, as a coworker's to its own.
const FOREMAN_COWORKER_HUB_TOOLS = new Set(['team_status', 'team_list_schedules', 'team_list_triggers', 'team_list_runs', 'team_get_run', 'rerun_credit', 'service_search', 'service_details', 'service_install', 'service_list_installed', 'service_uninstall', 'trigger_url', 'publish_file', 'unpublish_file', 'list_published'])

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

    // The Chief of Staff is known by its fixed id: it speaks for the whole workspace the engine key names.
    const isForeman = engineAgentId === FOREMAN_AGENT_ID
    const asCoworker = isForeman && FOREMAN_COWORKER_HUB_TOOLS.has(tool)
    // The person the foreman's turn speaks for, from its signed token: their access, not the
    // workspace's. A token without one (minted before, or no token at all) and a coworker act as the
    // workspace.
    let actor: Actor = workspaceActor(engine.workspaceId)
    // A check-in's token: only the tools that read pass, whoever it speaks for.
    let readOnly = false
    if (isForeman) {
        const foremanToken = req.headers.get(FOREMAN_HUB_TOKEN_HEADER)
        if (foremanToken) {
            const claims = verifyForemanHubToken(foremanToken, engine.workspaceId)
            if (!claims) return new Response('Invalid foreman token', { status: 403 })
            readOnly = claims.scope === 'read'
            if (claims.uid) {
                const member = await memberActor(engine.workspaceId, claims.uid)
                if (!member) return new Response('The member this foreman speaks for has left the workspace', { status: 403 })
                actor = member
            }
        } else if (!asCoworker && foremanHubTokenRequired()) {
            return new Response('Missing foreman token', { status: 403 })
        } else if (!asCoworker) {
            console.warn('[hub] foreman call without token (tolerated)', { workspaceId: engine.workspaceId })
        }
    }
    if (readOnly && !FOREMAN_READ_TOOL_NAMES.has(tool)) return new Response('A check-in only reads', { status: 403 })

    const supabase = createServiceRoleClient()
    const { data: agent } = isForeman ? { data: null } : await selectMaybeSingle(supabase, 'agents', ['id'] as const, { engine_agent_id: engineAgentId, workspace_id: engine.workspaceId })
    if (!isForeman && !agent) return new Response('Coworker does not belong to the authenticated workspace', { status: 403 })
    const callerAgentId = agent?.id ?? FOREMAN_AGENT_ID

    try {
        const out =
            isForeman && !asCoworker
                ? await dispatchForemanHubTool(actor, tool, args)
                : isTeamHubTool(tool)
                  ? await dispatchTeamHubTool(callerAgentId, engine.workspaceId, tool, args, actor)
                  : isAiStatusHubTool(tool)
                    ? await readRerunCredit(engine.workspaceId)
                    : await dispatchHubTool(callerAgentId, tool, args, engine.workspaceId, actor)
        return Response.json(out)
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Hub tool failed'
        console.error(`[hub] ${tool} failed:`, message)
        return Response.json({ error: brandText(message, await workspaceBrand(engine.workspaceId)) })
    }
}
