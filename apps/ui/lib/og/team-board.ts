import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'
import type { BoardScene } from './board-image'

// No 'server-only': the lifecycle and the WhatsApp sweeps build a board from Trigger.dev tasks.

// The board's eight slots are also as many coworkers as a picture of it can hold.
const TEAM_LIMIT = 8
const BOARD_NAME_LIMIT = 40

// A board needs somebody on it, so a workspace without a coworker gets a nameless one.
const NAMELESS_COWORKER = 'Your coworker'

export type TeamMember = { id: string; name: string }
export type BoardStatus = NonNullable<BoardScene['agents'][number]['status']>

// One status for the whole team, or one per agent id for a message about some of them only: the
// others stand on the board without one.
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

/**
 * The coworkers a workspace would lose, oldest first: the first one hired is the one its owner
 * knows by name. One switched off by a plan limit is not part of it. `mustInclude` is read even
 * past the eighth, for a message about a coworker hired late in a large team.
 */
export async function loadTeam(supabase: SupabaseClient<Database>, workspaceId: number, mustInclude: string[] = []): Promise<TeamMember[]> {
    const { data } = await selectMany(supabase, 'agents', ['id', 'name'] as const, { workspace_id: workspaceId, kind: 'coworker', disabled_at: { isNull: true } }, { column: 'created_at', ascending: true }, TEAM_LIMIT)
    const team = data ?? []

    const missing = mustInclude.filter(id => !team.some(agent => agent.id === id))
    if (missing.length) {
        const { data: extra } = await selectMany(supabase, 'agents', ['id', 'name'] as const, { workspace_id: workspaceId, kind: 'coworker', id: missing })
        team.push(...(extra ?? []))
    }

    return team.map(agent => ({ id: agent.id, name: agent.name.trim() })).filter(agent => agent.name)
}

function statusOf(agent: TeamMember, status: TeamStatus): BoardStatus | undefined {
    return typeof status === 'string' ? status : status[agent.id]
}

// The coworkers a message is about stand first, so the eight-slot cut never leaves them out.
export function teamBoardScene(team: TeamMember[], status: TeamStatus): BoardScene {
    if (!team.length) return { agents: [{ name: NAMELESS_COWORKER, status: typeof status === 'string' ? status : undefined }] }

    const placed = team.map(agent => ({ name: agent.name.slice(0, BOARD_NAME_LIMIT), status: statusOf(agent, status) }))
    const agents = [...placed.filter(agent => agent.status), ...placed.filter(agent => !agent.status)].slice(0, TEAM_LIMIT)
    return { agents }
}
