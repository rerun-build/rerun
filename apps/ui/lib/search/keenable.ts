import type { WebSearch } from '@/lib/search/web-search'

const KEENABLE_PUBLIC_URL = 'https://api.keenable.ai/v1/search/public'
const KEENABLE_KEYED_URL = 'https://api.keenable.ai/v1/search'
const TIMEOUT_MS = 10_000
const SNIPPET_MAX_LENGTH = 400

type KeenableResponse = { results?: { title?: string | null; url?: string | null; snippet?: string | null }[] }

// Keyless by default; KEENABLE_API_KEY only lifts the per-IP rate limit.
export async function searchKeenable(query: string, count: number): Promise<WebSearch> {
    const apiKey = process.env.KEENABLE_API_KEY
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Keenable-Title': 'Rerun' }
    if (apiKey) headers['X-API-Key'] = apiKey

    try {
        const res = await fetch(apiKey ? KEENABLE_KEYED_URL : KEENABLE_PUBLIC_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, max_results: count, snippet_max_length: SNIPPET_MAX_LENGTH }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) return { status: res.status, ok: false, results: [] }

        const data = (await res.json()) as KeenableResponse
        const results = (data.results ?? []).filter(r => r.url).map(r => ({ title: r.title ?? '', url: r.url ?? '', snippet: (r.snippet ?? '').replace(/\s+/g, ' ').trim() }))
        return { status: res.status, ok: true, results }
    } catch {
        return { status: null, ok: false, results: [] }
    }
}
