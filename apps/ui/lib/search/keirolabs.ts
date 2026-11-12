import type { WebSearch } from '@/lib/search/web-search'

// The lite endpoint: titles, links and snippets, billed flat per request whatever the count.
const KEIROLABS_SEARCH_URL = 'https://api.keirolabs.cloud/api/v2/search/lite'
const TIMEOUT_MS = 10_000

type KeirolabsResponse = { results?: { title?: string | null; url?: string | null; snippet?: string | null }[] }

// Returns null when no key is configured: the caller has nothing to search with.
export async function searchKeirolabs(query: string, count: number): Promise<WebSearch | null> {
    const apiKey = process.env.KEIROLABS_API_KEY
    if (!apiKey) return null

    try {
        const res = await fetch(KEIROLABS_SEARCH_URL, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ query, maxResults: count }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) return { status: res.status, ok: false, results: [] }

        const data = (await res.json()) as KeirolabsResponse
        const results = (data.results ?? []).filter(r => r.url).map(r => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.snippet ?? '' }))
        return { status: res.status, ok: true, results }
    } catch {
        return { status: null, ok: false, results: [] }
    }
}
