import type { CollectorId } from './catalog'

// What the onboarding board shows of a company exploration while it runs: one card per thing we
// learnt, and a teaser for every source still being read. Client-safe like the catalog, and the same
// vocabulary for the live stream of the welcome card and for the rows the full exploration writes.

// `profile` is the quick read of the home page the welcome card already runs, not a collector.
export type DiscoverySource = CollectorId | 'profile'

export type SpottedTool = { name: string; iconUrl: string | null }

export type CompanyFinding =
    | { kind: 'identity'; source: DiscoverySource; name: string; oneLiner: string | null; logoUrl: string | null; domain: string }
    | { kind: 'audience'; source: DiscoverySource; text: string }
    | { kind: 'tools'; source: DiscoverySource; tools: SpottedTool[] }
    | { kind: 'mail'; source: DiscoverySource; provider: string; iconUrl: string | null }
    | { kind: 'social'; source: DiscoverySource; networks: { name: string; iconUrl: string | null; audience: string | null }[] }
    | { kind: 'brand'; source: DiscoverySource; colors: string[]; fonts: string[] }
    | { kind: 'registry'; source: DiscoverySource; founded: string | null; headcount: string | null; city: string | null }
    | { kind: 'person'; source: DiscoverySource; name: string; headline: string | null; photoUrl: string | null }
    | { kind: 'linkedin'; source: DiscoverySource; followers: number | null; employees: number | null }
    | { kind: 'reviews'; source: DiscoverySource; rating: number; count: number }
    | { kind: 'products'; source: DiscoverySource; items: string[] }
    | { kind: 'competitors'; source: DiscoverySource; items: string[] }
    | { kind: 'customers'; source: DiscoverySource; items: string[] }
    // The outline is missing from the rows written before the card listed its pages.
    | { kind: 'brain'; source: DiscoverySource; pages: number; topics?: string[]; products?: number; competitors?: number }

export type FindingKind = CompanyFinding['kind']

export type DiscoveryEvent =
    | { type: 'pending'; source: DiscoverySource }
    | { type: 'found'; source: DiscoverySource; findings: CompanyFinding[] }
    | { type: 'dropped'; source: DiscoverySource }
    | { type: 'end' }

export type DiscoveryEntry =
    | { id: string; order: number; source: DiscoverySource; type: 'teaser' }
    // `arrival` counts every landing, an update included, so the latest news can be told apart from
    // the card standing highest in its column.
    | { id: string; order: number; source: DiscoverySource; type: 'finding'; finding: CompanyFinding; arrival: number }

export type DiscoveriesState = { entries: DiscoveryEntry[]; nextOrder: number; arrivals: number; ended: boolean }

export const EMPTY_DISCOVERIES: DiscoveriesState = { entries: [], nextOrder: 0, arrivals: 0, ended: false }

const teaserId = (source: DiscoverySource) => `teaser:${source}`

export const findingId = (finding: CompanyFinding) => `finding:${finding.kind}`

// Findings are plain JSON, built by the same code on every pass, so their serialisations compare.
export const sameFinding = (a: CompanyFinding, b: CompanyFinding) => JSON.stringify(a) === JSON.stringify(b)

// A finding takes the place of the teaser that announced it, so the card lands where the eye was
// already waiting. A kind seen before is updated where it stands: the quick read of the site and the
// full exploration describe the same company, and the second only sharpens the first.
export function applyDiscoveryEvent(state: DiscoveriesState, event: DiscoveryEvent): DiscoveriesState {
    if (event.type === 'end') return { ...state, ended: true, entries: state.entries.filter(entry => entry.type !== 'teaser') }

    if (event.type === 'pending') {
        if (state.entries.some(entry => entry.source === event.source)) return { ...state, ended: false }
        return { ...state, ended: false, nextOrder: state.nextOrder + 1, entries: [...state.entries, { id: teaserId(event.source), order: state.nextOrder, source: event.source, type: 'teaser' }] }
    }

    const teaser = state.entries.find(entry => entry.id === teaserId(event.source))
    const entries = state.entries.filter(entry => entry !== teaser)
    if (event.type === 'dropped') return { ...state, entries }

    let nextOrder = state.nextOrder
    let arrivals = state.arrivals
    event.findings.forEach((finding, rank) => {
        const id = findingId(finding)
        const existing = entries.findIndex(entry => entry.id === id)
        const current = entries[existing]
        // The board re-reads the whole exploration every few seconds: a card it already shows is not news.
        if (current?.type === 'finding' && sameFinding(current.finding, finding)) return
        const arrival = arrivals++
        if (existing >= 0) {
            entries[existing] = { id, order: entries[existing].order, source: event.source, type: 'finding', finding, arrival }
            return
        }
        const order = teaser ? teaser.order + rank / event.findings.length : nextOrder++
        entries.push({ id, order, source: event.source, type: 'finding', finding, arrival })
    })
    return { ...state, nextOrder, arrivals, entries }
}

// What the full exploration leaves in `workspace_onboarding.company_findings`: written as each source
// lands, read back by the board every few seconds and after a reload.
export type CompanyFindingsRow = { url: string; status: 'running' | 'done' | 'failed'; pending: DiscoverySource[]; findings: CompanyFinding[] }

export function applyToRow(row: CompanyFindingsRow, event: DiscoveryEvent): CompanyFindingsRow {
    if (event.type === 'end') return { ...row, status: row.status === 'running' ? 'done' : row.status, pending: [] }
    if (event.type === 'pending') return row.pending.includes(event.source) ? row : { ...row, pending: [...row.pending, event.source] }

    const pending = row.pending.filter(source => source !== event.source)
    if (event.type === 'dropped') return { ...row, pending }
    const kinds = new Set(event.findings.map(finding => finding.kind))
    return { ...row, pending, findings: [...row.findings.filter(finding => !kinds.has(finding.kind)), ...event.findings] }
}

// The events that bring the board from where it stands to the row, and nothing it already shows.
export function rowToEvents(row: CompanyFindingsRow, state: DiscoveriesState): DiscoveryEvent[] {
    const shown = new Map(state.entries.flatMap(entry => (entry.type === 'finding' ? [[entry.id, entry.finding] as const] : [])))
    const fresh = row.findings.filter(finding => {
        const current = shown.get(findingId(finding))
        return !current || !sameFinding(current, finding)
    })
    // The quick read of the home page belongs to the welcome card's own stream, which closes it.
    const teasing = state.entries.flatMap(entry => (entry.type === 'teaser' && entry.source !== 'profile' ? [entry.source] : []))
    const settled = row.status !== 'running'

    return [
        ...row.pending.map(source => ({ type: 'pending' as const, source })),
        ...fresh.map(finding => ({ type: 'found' as const, source: finding.source, findings: [finding] })),
        ...teasing.filter(source => !row.pending.includes(source)).map(source => ({ type: 'dropped' as const, source })),
        ...(settled && !state.ended ? [{ type: 'end' as const }] : []),
    ]
}
