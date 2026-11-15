import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'
import type { BoardScene } from './board-image'

const TEAM_LIMIT = 8
const BOARD_NAME_LIMIT = 40

const NAMELESS_COWORKER = 'Your coworker'

export type TeamMember = { id: string; name: string }
export type BoardStatus = NonNullable<BoardScene['agents'][number]['status']>

export type TeamStatus = BoardStatus | Record<string, BoardStatus>

type NotificationKind = Database['public']['Enums']['notification_kind']

const BOARD_STATUS_OF_KIND: Record<NotificationKind, BoardStatus> = {
    question: 'waiting_human',
    approval: 'waiting_human',
    connector: 'waiting_human',
    info: 'working',
    done: 'idle',
    error: 'error',
}

export function boardStatusOfKind(kind: NotificationKind): BoardStatus {
    return BOARD_STATUS_OF_KIND[kind]
}

export async function loadTeam(supabase: SupabaseClient<Database>, workspaceId: number, mustInclude: string[] = []): Promise<TeamMember[]> {
    const { data } = await selectMany(supabase, 'agents', ['id', 'name'] as const, { workspace_id: workspaceId, disabled_at: { isNull: true } }, { column: 'created_at', ascending: true }, TEAM_LIMIT)
    const team = data ?? []

    const missing = mustInclude.filter(id => !team.some(agent => agent.id === id))
    if (missing.length) {
        const { data: extra } = await selectMany(supabase, 'agents', ['id', 'name'] as const, { workspace_id: workspaceId, id: missing })
        team.push(...(extra ?? []))
    }

    return team.map(agent => ({ id: agent.id, name: agent.name.trim() })).filter(agent => agent.name)
}

function statusOf(agent: TeamMember, status: TeamStatus): BoardStatus | undefined {
    return typeof status === 'string' ? status : status[agent.id]
}

export function teamBoardScene(team: TeamMember[], status: TeamStatus): BoardScene {
    if (!team.length) return { agents: [{ name: NAMELESS_COWORKER, status: typeof status === 'string' ? status : undefined }] }

    const placed = team.map(agent => ({ name: agent.name.slice(0, BOARD_NAME_LIMIT), status: statusOf(agent, status) }))
    const agents = [...placed.filter(agent => agent.status), ...placed.filter(agent => !agent.status)].slice(0, TEAM_LIMIT)
    return { agents }
}
