import type { WorkspaceSearchKind } from '@rerun/contracts'

// The sources of the global search, in the order of their chips. The machine answers for every one
// but the coworkers' names and the conversations, which the app already holds.
export type SearchSource = WorkspaceSearchKind | 'conversation'

export type SearchFilter = SearchSource | 'all'

export const SEARCH_SOURCES: readonly SearchSource[] = ['coworker', 'skill', 'file', 'brain', 'table', 'conversation']

export const SEARCH_FILTERS: readonly SearchFilter[] = ['all', ...SEARCH_SOURCES]

// The sources the machine alone answers for; a coworker's name is known before its soul is read.
export const MACHINE_SOURCES: ReadonlySet<SearchSource> = new Set<SearchSource>(['skill', 'file', 'brain', 'table'])

// Whether the list still owes an answer for what it shows, so it never says "nothing" too early.
export function stillSearching(filter: SearchFilter, found: ReadonlySet<SearchSource>, loading: { machine: boolean; conversations: boolean }): boolean {
    if (filter === 'conversation') return loading.conversations && found.size === 0
    if (filter !== 'all') return loading.machine && found.size === 0
    return (loading.machine && ![...found].some(source => MACHINE_SOURCES.has(source))) || (loading.conversations && found.size === 0)
}

// Tab and Shift+Tab walk the chips, round and round.
export function stepFilter(current: SearchFilter, step: 1 | -1): SearchFilter {
    const index = SEARCH_FILTERS.indexOf(current)
    return SEARCH_FILTERS[(index + step + SEARCH_FILTERS.length) % SEARCH_FILTERS.length]
}

export type HighlightPart = { text: string; match: boolean }

// The text cut around every mention of `needle`, whatever its case.
export function highlightParts(text: string, needle: string): HighlightPart[] {
    const wanted = needle.trim().toLowerCase()
    if (wanted.length < 2) return [{ text, match: false }]
    const lower = text.toLowerCase()
    const parts: HighlightPart[] = []
    let from = 0
    for (let at = lower.indexOf(wanted); at !== -1; at = lower.indexOf(wanted, from)) {
        if (at > from) parts.push({ text: text.slice(from, at), match: false })
        parts.push({ text: text.slice(at, at + wanted.length), match: true })
        from = at + wanted.length
    }
    if (from < text.length) parts.push({ text: text.slice(from), match: false })
    return parts
}

// `marketing/q4-plan.md` → `{ name: 'q4-plan.md', folder: 'marketing/' }`.
export function splitPath(path: string): { name: string; folder: string } {
    const cut = path.lastIndexOf('/')
    return cut === -1 ? { name: path, folder: '' } : { name: path.slice(cut + 1), folder: path.slice(0, cut + 1) }
}
