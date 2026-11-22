// Which coworkers the dock shows and in what order, without Electron. The main window publishes every
// coworker of its workspace; the person's order and the ones they hid are kept here, on this computer,
// for each server and workspace, and never touch the order of the sidebar.

export type DockArrangement = { order: string[]; hidden: string[] }
export type DockArrangements = Record<string, DockArrangement>

const MAX_IDS = 200
// One per server and workspace the person showed in the app; the oldest goes first.
const MAX_WORKSPACES = 20

export const EMPTY_ARRANGEMENT: DockArrangement = { order: [], hidden: [] }

export function arrangementKey(server: string, workspaceKey: string): string {
    return `${server} ${workspaceKey}`
}

function cleanIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    const ids = raw.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100)
    return [...new Set(ids)].slice(0, MAX_IDS)
}

export function cleanArrangement(raw: unknown): DockArrangement {
    if (!raw || typeof raw !== 'object') return EMPTY_ARRANGEMENT
    const { order, hidden } = raw as Record<string, unknown>
    return { order: cleanIds(order), hidden: cleanIds(hidden) }
}

export function cleanArrangements(raw: unknown): DockArrangements {
    if (!raw || typeof raw !== 'object') return {}
    const entries = Object.entries(raw as Record<string, unknown>).filter(([key]) => key.length > 0 && key.length <= 400)
    return Object.fromEntries(entries.slice(-MAX_WORKSPACES).map(([key, value]) => [key, cleanArrangement(value)]))
}

// Written last, so it is the one kept when there are too many.
export function withArrangement(arrangements: DockArrangements, key: string, arrangement: DockArrangement): DockArrangements {
    const others = Object.entries(arrangements).filter(([candidate]) => candidate !== key)
    return cleanArrangements(Object.fromEntries([...others, [key, arrangement]]))
}

// The order the person chose, then whoever they never placed in the order the main window published
// them: a new coworker shows, and the Chief of Staff, published first, leads until it is moved.
// Someone the person never placed sits right after the one published just before it.
export function arrangeDock<C extends { id: string }>(coworkers: readonly C[], arrangement: DockArrangement): C[] {
    const rank = new Map(arrangement.order.map((id, index) => [id, index]))
    const hidden = new Set(arrangement.hidden)
    const placed = coworkers.filter((coworker) => rank.has(coworker.id)).sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number))
    const arranged = [...placed]
    coworkers.forEach((coworker, index) => {
        if (rank.has(coworker.id)) return
        const previous = coworkers
            .slice(0, index)
            .reverse()
            .find((candidate) => arranged.includes(candidate))
        arranged.splice(previous ? arranged.indexOf(previous) + 1 : 0, 0, coworker)
    })
    return arranged.filter((coworker) => !hidden.has(coworker.id))
}

// The coworkers shown, in the order they were dragged to; the hidden ones keep their place after them.
export function reorderArrangement(arrangement: DockArrangement, shownIds: readonly string[], allIds: readonly string[]): DockArrangement {
    const known = new Set(allIds)
    const shown = cleanIds(shownIds).filter((id) => known.has(id))
    const rest = [...arrangement.order, ...allIds].filter((id) => !shown.includes(id))
    return { order: cleanIds([...shown, ...rest]), hidden: arrangement.hidden }
}

export function setHidden(arrangement: DockArrangement, id: string, hidden: boolean): DockArrangement {
    const others = arrangement.hidden.filter((candidate) => candidate !== id)
    return { order: arrangement.order, hidden: cleanIds(hidden ? [...others, id] : others) }
}
