import type { CollectorId } from './catalog'

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
    | { kind: 'brain'; source: DiscoverySource; pages: number; topics?: string[]; products?: number; competitors?: number }

export type FindingKind = CompanyFinding['kind']

export type DiscoveryEvent =
    | { type: 'pending'; source: DiscoverySource }
    | { type: 'found'; source: DiscoverySource; findings: CompanyFinding[] }
    | { type: 'dropped'; source: DiscoverySource }
    | { type: 'end' }

type Subject = { name: string; domain: string }

export const DISCOVERY_TEASERS: Record<DiscoverySource, { line: (subject: Subject) => string }> = {
    profile: { line: ({ domain }) => `Reading ${domain}…` },
    stack: { line: ({ domain }) => `Peeking under the hood of ${domain}…` },
    dns: { line: () => 'Checking how you run email…' },
    registry: { line: () => 'Looking you up in the public registry…' },
    site: { line: ({ domain }) => `Reading every page of ${domain}…` },
    search: { line: ({ name }) => `Searching the web for ${name}…` },
    linkedinPerson: { line: () => 'Looking for you on LinkedIn…' },
    linkedinCompany: { line: ({ name }) => `Finding ${name} on LinkedIn…` },
    googleBusiness: { line: () => 'Reading your Google reviews…' },
    catalog: { line: ({ domain }) => `Browsing the ${domain} shop…` },
    synthesis: { line: () => 'Piecing it all together…' },
}

export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
    profile: 'Your website',
    stack: 'Your website',
    site: 'Your website',
    dns: 'Your domain',
    registry: 'Public registry',
    search: 'The web',
    linkedinPerson: 'LinkedIn',
    linkedinCompany: 'LinkedIn',
    googleBusiness: 'Google',
    catalog: 'Your website',
    synthesis: 'Moldwright',
}

export type DiscoveryEntry =
    | { id: string; order: number; source: DiscoverySource; type: 'teaser' }
    | { id: string; order: number; source: DiscoverySource; type: 'finding'; finding: CompanyFinding; arrival: number }

export type DiscoveriesState = { entries: DiscoveryEntry[]; nextOrder: number; arrivals: number; ended: boolean }

export const EMPTY_DISCOVERIES: DiscoveriesState = { entries: [], nextOrder: 0, arrivals: 0, ended: false }

const teaserId = (source: DiscoverySource) => `teaser:${source}`

export const findingId = (finding: CompanyFinding) => `finding:${finding.kind}`

export const sameFinding = (a: CompanyFinding, b: CompanyFinding) => JSON.stringify(a) === JSON.stringify(b)

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

export type CompanyFindingsRow = { url: string; status: 'running' | 'done' | 'failed'; pending: DiscoverySource[]; findings: CompanyFinding[] }

export function applyToRow(row: CompanyFindingsRow, event: DiscoveryEvent): CompanyFindingsRow {
    if (event.type === 'end') return { ...row, status: row.status === 'running' ? 'done' : row.status, pending: [] }
    if (event.type === 'pending') return row.pending.includes(event.source) ? row : { ...row, pending: [...row.pending, event.source] }

    const pending = row.pending.filter(source => source !== event.source)
    if (event.type === 'dropped') return { ...row, pending }
    const kinds = new Set(event.findings.map(finding => finding.kind))
    return { ...row, pending, findings: [...row.findings.filter(finding => !kinds.has(finding.kind)), ...event.findings] }
}

export function rowToEvents(row: CompanyFindingsRow, state: DiscoveriesState): DiscoveryEvent[] {
    const shown = new Map(state.entries.flatMap(entry => (entry.type === 'finding' ? [[entry.id, entry.finding] as const] : [])))
    const fresh = row.findings.filter(finding => {
        const current = shown.get(findingId(finding))
        return !current || !sameFinding(current, finding)
    })
    const teasing = state.entries.flatMap(entry => (entry.type === 'teaser' && entry.source !== 'profile' ? [entry.source] : []))
    const settled = row.status !== 'running'

    return [
        ...row.pending.map(source => ({ type: 'pending' as const, source })),
        ...fresh.map(finding => ({ type: 'found' as const, source: finding.source, findings: [finding] })),
        ...teasing.filter(source => !row.pending.includes(source)).map(source => ({ type: 'dropped' as const, source })),
        ...(settled && !state.ended ? [{ type: 'end' as const }] : []),
    ]
}
