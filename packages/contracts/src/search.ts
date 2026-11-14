export type QueryScope = 'all' | 'agents' | 'commands'

export type ParsedQuery = { scope: QueryScope; text: string }

const SCOPE_PREFIXES: Record<string, QueryScope> = { '@': 'agents', '/': 'commands' }

export function parseQuery(raw: string): ParsedQuery {
    const trimmed = raw.trimStart()
    const scope = SCOPE_PREFIXES[trimmed[0]]
    if (scope) return { scope, text: trimmed.slice(1).trim().toLowerCase() }
    return { scope: 'all', text: trimmed.trim().toLowerCase() }
}

export type Searchable = { label: string; keywords?: readonly string[] }

const LABEL_PREFIX = 0
const LABEL_WORD = 1
const LABEL_INSIDE = 2
const KEYWORD_PREFIX = 3
const KEYWORD_INSIDE = 4

function startsAWord(haystack: string, needle: string): boolean {
    return haystack.split(/[\s\-_/.]+/).some(word => word.startsWith(needle))
}

export function matchRank(item: Searchable, text: string): number | null {
    const label = item.label.toLowerCase()
    if (label.startsWith(text)) return LABEL_PREFIX
    if (startsAWord(label, text)) return LABEL_WORD
    if (label.includes(text)) return LABEL_INSIDE

    const keywords = (item.keywords ?? []).map(keyword => keyword.toLowerCase())
    if (keywords.some(keyword => keyword.startsWith(text) || startsAWord(keyword, text))) return KEYWORD_PREFIX
    if (keywords.some(keyword => keyword.includes(text))) return KEYWORD_INSIDE
    return null
}

export function searchItems<T extends Searchable>(items: readonly T[], text: string, limit = Infinity): T[] {
    if (!text) return items.slice(0, limit)
    const ranked: { item: T; rank: number; index: number }[] = []
    items.forEach((item, index) => {
        const rank = matchRank(item, text)
        if (rank !== null) ranked.push({ item, rank, index })
    })
    return ranked
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, limit)
        .map(entry => entry.item)
}
