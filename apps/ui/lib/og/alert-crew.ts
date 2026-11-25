import { parseCoworkerLook } from '@rerun/contracts'
import { hashedBuddyLook } from '@rerun/ui/iso-grid/buddy-look'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'

import { ALERT_CREW_LIMIT, ALERT_NEIGHBOUR_LIMIT, type AlertBoard, type AlertCause, type AlertCoworker, type AlertState } from './alert-board'

// No 'server-only': the payment notice runs outside a request too.

const NAME_LIMIT = 40
const AGENT_COLUMNS = ['id', 'name', 'look'] as const

// A board needs somebody on it, so a workspace without a coworker gets a nameless one.
const NAMELESS_COWORKER = 'Your coworker'

type CrewRow = { id: string; name: string; look: unknown }

function wornBy({ id, name, look }: CrewRow): AlertCoworker {
    return { name: name.trim().slice(0, NAME_LIMIT).trim(), look: parseCoworkerLook(look) ?? hashedBuddyLook(id) }
}

const named = (rows: CrewRow[] | null) => (rows ?? []).filter(row => row.name.trim())

// The oldest first, like every picture of a team: the first one hired is the one its owner knows by name.
async function loadTeam(supabase: SupabaseClient<Database>, workspaceId: number, limit: number): Promise<CrewRow[]> {
    const { data } = await selectMany(supabase, 'agents', AGENT_COLUMNS, { workspace_id: workspaceId, kind: 'coworker', disabled_at: { isNull: true } }, { column: 'created_at', ascending: true }, limit)
    return named(data)
}

export async function coworkerAlertBoard(supabase: SupabaseClient<Database>, workspaceId: number, agentId: string, state: AlertState, app?: string): Promise<AlertBoard | null> {
    const [{ data }, team] = await Promise.all([selectMany(supabase, 'agents', AGENT_COLUMNS, { workspace_id: workspaceId, id: [agentId] }), loadTeam(supabase, workspaceId, ALERT_NEIGHBOUR_LIMIT + 1)])
    const [focus] = named(data)
    if (!focus) return null
    const neighbours = team.filter(row => row.id !== agentId).slice(0, ALERT_NEIGHBOUR_LIMIT)
    return { kind: 'coworker', state, coworker: wornBy(focus), neighbours: neighbours.map(wornBy), ...(app && { app }) }
}

/** `agentIds` are the coworkers the cause stopped; left out, it stopped the whole team. */
export async function causeAlertBoard(supabase: SupabaseClient<Database>, workspaceId: number, cause: AlertCause, agentIds?: string[]): Promise<AlertBoard> {
    const { data } = agentIds ? await selectMany(supabase, 'agents', AGENT_COLUMNS, { workspace_id: workspaceId, id: agentIds.slice(0, ALERT_CREW_LIMIT) }, { column: 'created_at', ascending: true }) : { data: null }
    const crew = agentIds ? named(data) : await loadTeam(supabase, workspaceId, ALERT_CREW_LIMIT)
    return { kind: 'cause', cause, coworkers: crew.length ? crew.map(wornBy) : [{ name: NAMELESS_COWORKER, look: hashedBuddyLook(NAMELESS_COWORKER) }] }
}
