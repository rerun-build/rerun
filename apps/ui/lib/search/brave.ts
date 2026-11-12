import type { WebSearch } from '@/lib/search/web-search'

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const TIMEOUT_MS = 10_000

type BraveResponse = { web?: { results?: { title?: string; url?: string; description?: string }[] } }

// Returns null when no key is configured: the caller has nothing to search with.
export async function searchBrave(query: string, count: number): Promise<WebSearch | null> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY
    if (!apiKey) return null

    try {
        const res = await fetch(`${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${count}`, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) return { status: res.status, ok: false, results: [] }

        const data = (await res.json()) as BraveResponse
        const results = (data.web?.results ?? []).filter(r => r.url).map(r => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.description ?? '' }))
        return { status: res.status, ok: true, results }
    } catch {
        return { status: null, ok: false, results: [] }
    }
}
