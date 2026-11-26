import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { sidebarSections } from '@/lib/workspace-view'

type Coworker = { id: string; name: string; spaceId: string }
type Placed = { id: string; createdAt?: string; sidebarOrder?: number | null }
type Box = { id: string; name: string | null; created_at: string | null; sidebar_order?: number | null }

export type VaultBoxGroup<C> = { id: string; name: string | null; coworkers: C[] }

// The coworkers of an entry as the web list arranges them: the Chief of Staff apart, then one group per
// Box that holds someone. `loose` is whoever sits in a Box the board has not loaded, and everyone when
// there is a single Box, whose name would tell nothing.
export function vaultBoxGroups<C extends Coworker>(coworkers: readonly C[], agents: readonly Placed[], boxes: readonly Box[]): { chief: C | null; groups: VaultBoxGroup<C>[]; loose: C[] } {
    const placedOf = new Map(agents.map(agent => [agent.id, agent]))
    const boxed = coworkers
        .filter(coworker => coworker.id !== FOREMAN_AGENT_ID)
        .map(coworker => ({ name: coworker.name, spaceId: coworker.spaceId, createdAt: placedOf.get(coworker.id)?.createdAt, sidebarOrder: placedOf.get(coworker.id)?.sidebarOrder, coworker }))
    const groups = sidebarSections(boxed, boxes)
        .filter(section => section.members.length > 0)
        .map(({ box, members }) => ({ id: box.id, name: box.name, coworkers: members.map(member => member.coworker) }))
    const known = new Set(groups.map(group => group.id))
    const unknown = boxed.filter(({ spaceId }) => !known.has(spaceId)).map(({ coworker }) => coworker)
    const chief = coworkers.find(coworker => coworker.id === FOREMAN_AGENT_ID) ?? null
    if (groups.length === 1 && unknown.length === 0) return { chief, groups: [], loose: groups[0].coworkers }
    return { chief, groups, loose: unknown }
}
