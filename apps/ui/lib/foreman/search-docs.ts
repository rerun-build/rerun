import { docsUrl } from '@/lib/site'

// The public documentation, read live from the Mintlify export rather than from apps/docs. The docs
// ship on their own branch and are served from another host, so reading them over the wire is what
// keeps what the foreman quotes identical to what the user finds behind the link it hands them.
const CORPUS_PATH = '/llms-full.txt'
const CORPUS_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const PASSAGE_LIMIT = 4
const PASSAGE_CHARS = 1600

export type DocsSection = { page: string; heading: string | null; url: string; body: string }

export type DocsSearchResult = {
    documentation: string
    passages: { title: string; url: string; text: string }[]
    pages?: { title: string; url: string }[]
    note?: string
}

let corpus: { sections: DocsSection[]; readAt: number } | null = null

// Mintlify writes one page per `# Title` / `Source: url` pair, with the headings of the page below
// it. A section is what gets ranked and quoted: a whole page is several thousand tokens of which the
// question usually needs one part.
export function parseDocsSections(text: string): DocsSection[] {
    const pages = [...text.matchAll(/^# (.+)[\r\n]+Source: (\S+)[^\n]*$/gm)]

    return pages.flatMap((page, index) => {
        const start = (page.index ?? 0) + page[0].length
        const end = index + 1 < pages.length ? (pages[index + 1].index ?? text.length) : text.length
        return splitByHeading(text.slice(start, end), page[1].trim(), page[2].trim())
    })
}

function splitByHeading(body: string, page: string, url: string): DocsSection[] {
    const headings = [...body.matchAll(/^## (.+)$/gm)]
    const intro = { page, heading: null, url, body: body.slice(0, headings[0]?.index ?? body.length).trim() }

    const sections = headings.map((heading, index) => ({
        page,
        heading: heading[1].trim(),
        url: `${url}#${anchor(heading[1])}`,
        body: body.slice(heading.index ?? 0, index + 1 < headings.length ? (headings[index + 1].index ?? body.length) : body.length).trim(),
    }))

    return [intro, ...sections].filter(section => section.body.length > 0)
}

function anchor(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

// Words carried by half the corpus rank every section equally, which is the same as ranking none.
const IGNORED_TERMS = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'that', 'this', 'what', 'how', 'why', 'when', 'does', 'can', 'are', 'from', 'about', 'rerun', 'agent', 'agents'])

function queryTerms(query: string): string[] {
    const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? []
    const kept = [...new Set(words)].filter(word => word.length > 2 && !IGNORED_TERMS.has(word))
    // A question made only of common words still deserves an answer, so nothing is dropped when
    // dropping would leave nothing.
    return kept.length ? kept : [...new Set(words)].filter(word => word.length > 2)
}

export function rankDocsSections(sections: DocsSection[], query: string, limit = PASSAGE_LIMIT): DocsSection[] {
    const terms = queryTerms(query)
    if (!terms.length) return []

    const scored = sections
        .map(section => ({ section, score: scoreSection(section, terms) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)

    // One page rarely answers with four of its own sections, and when it does the user is better
    // served by the link than by the whole page pasted back.
    const perPage = new Map<string, number>()
    const picked: DocsSection[] = []
    for (const { section } of scored) {
        const taken = perPage.get(section.page) ?? 0
        if (taken >= 2) continue
        perPage.set(section.page, taken + 1)
        picked.push(section)
        if (picked.length === limit) break
    }
    return picked
}

function scoreSection(section: DocsSection, terms: string[]): number {
    const body = section.body.toLowerCase()
    const title = `${section.page} ${section.heading ?? ''}`.toLowerCase()

    let score = 0
    let matched = 0
    for (const term of terms) {
        const hits = Math.min(occurrences(body, term), 5)
        if (hits) matched += 1
        score += hits + (title.includes(term) ? 6 : 0)
    }
    // A section holding every word of the question beats one repeating a single word, whatever its
    // length.
    return score ? score + matched * 10 : 0
}

function occurrences(haystack: string, term: string): number {
    let count = 0
    let from = 0
    for (;;) {
        const at = haystack.indexOf(term, from)
        if (at === -1) return count
        count += 1
        from = at + term.length
    }
}

async function loadSections(): Promise<DocsSection[]> {
    if (corpus && Date.now() - corpus.readAt < CORPUS_TTL_MS) return corpus.sections

    const response = await fetch(docsUrl(CORPUS_PATH), { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`docs.rerun.build answered ${response.status}`)

    const sections = parseDocsSections(await response.text())
    if (!sections.length) throw new Error('the documentation export came back empty')
    corpus = { sections, readAt: Date.now() }
    return sections
}

function sectionTitle(section: DocsSection): string {
    return section.heading ? `${section.page} - ${section.heading}` : section.page
}

/**
 * Answers a question about Rerun itself out of the public documentation. Never throws: a
 * documentation the app cannot reach right now still has a home page worth handing to the user.
 */
export async function searchDocs(query: string): Promise<DocsSearchResult> {
    const documentation = docsUrl()

    let sections: DocsSection[]
    try {
        sections = await loadSections()
    } catch (error) {
        return { documentation, passages: [], note: `The documentation could not be read (${error instanceof Error ? error.message : 'unknown error'}). Point the user at ${documentation} rather than answering from memory.` }
    }

    const hits = rankDocsSections(sections, query)
    if (!hits.length) {
        const pages = [...new Map(sections.map(section => [section.page, { title: section.page, url: section.url.split('#')[0] }])).values()]
        return { documentation, passages: [], pages, note: 'Nothing in the documentation matched those words. Try another wording against the pages listed here, and never invent an answer.' }
    }

    return {
        documentation,
        passages: hits.map(section => ({ title: sectionTitle(section), url: section.url, text: section.body.slice(0, PASSAGE_CHARS) })),
    }
}
