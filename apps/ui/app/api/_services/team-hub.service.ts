import { workspaceActor, type Actor } from '@/app/api/_auth/access'
import { getAgent } from '@/lib/engine/client'
import { getAgentChatTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'

const TEAM_READS = {
    team_status: 'get_team_status',
    team_list_schedules: 'list_schedules',
    team_list_triggers: 'list_triggers',
    team_list_runs: 'list_runs',
    team_get_run: 'get_run',
} as const

type TeamTool = keyof typeof TEAM_READS

export function isTeamHubTool(name: string): name is TeamTool {
    return Object.hasOwn(TEAM_READS, name)
}

async function assertTeamSwitchedOn(callerAgentId: string, actor: Actor): Promise<void> {
    const { conn, engineAgentId } = await getAgentChatTarget(callerAgentId, 'use', actor)
    const { config } = await getAgent(conn, engineAgentId)
    if (!config.tools.team) throw new Error('Reading other coworkers is switched off for this coworker.')
}

// A trigger URL carries its secret: a coworker that reads it could fire the other one.
function withoutTriggerUrls(result: unknown): unknown {
    const { triggers } = result as { triggers: Array<Record<string, unknown>> }
    return { triggers: triggers.map(({ url: _url, ...trigger }) => trigger) }
}

// `actor` is the workspace for a coworker of the box, and the member a foreman's turn speaks for, who
// reads only the Boxes they see.
export async function dispatchTeamHubTool(callerAgentId: string, workspaceId: number, name: TeamTool, args: Record<string, unknown>, actor: Actor = workspaceActor(workspaceId)): Promise<unknown> {
    await assertTeamSwitchedOn(callerAgentId, actor)
    const result = await dispatchAccountTool(actor, TEAM_READS[name], args)
    return name === 'team_list_triggers' ? withoutTriggerUrls(result) : result
}
