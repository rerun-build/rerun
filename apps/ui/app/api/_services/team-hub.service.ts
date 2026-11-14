import { workspaceActor } from '@/app/api/_auth/access'
import { getAgent } from '@/lib/engine/client'
import { resolveAgentTarget } from './chat.service'
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

async function assertTeamSwitchedOn(callerAgentId: string, workspaceId: number): Promise<void> {
    const { conn, engineAgentId } = await resolveAgentTarget(callerAgentId, workspaceActor(workspaceId))
    const { config } = await getAgent(conn, engineAgentId)
    if (!config.tools.team) throw new Error('Reading other coworkers is switched off for this coworker.')
}

function withoutTriggerUrls(result: unknown): unknown {
    const { triggers } = result as { triggers: Array<Record<string, unknown>> }
    return { triggers: triggers.map(({ url: _url, ...trigger }) => trigger) }
}

export async function dispatchTeamHubTool(callerAgentId: string, workspaceId: number, name: TeamTool, args: Record<string, unknown>): Promise<unknown> {
    await assertTeamSwitchedOn(callerAgentId, workspaceId)
    const result = await dispatchAccountTool(workspaceActor(workspaceId), TEAM_READS[name], args)
    return name === 'team_list_triggers' ? withoutTriggerUrls(result) : result
}
