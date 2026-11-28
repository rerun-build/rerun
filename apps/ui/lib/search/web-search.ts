import { searchBrave } from '@/lib/search/brave'
import { searchKeenable } from '@/lib/search/keenable'
import { searchKeirolabs } from '@/lib/search/keirolabs'

export type WebSearchResult = { title: string; url: string; snippet: string }

// `status` is null when the provider could not be reached at all.
export type WebSearch = { status: number | null; ok: boolean; results: WebSearchResult[] }

// Brave's largest page, and both providers bill a page the same as a single result.
export const WEB_SEARCH_PAGE_SIZE = 20

// Keenable needs no key, so it is never picked by default: a query leaves for a third party only
// when WEB_SEARCH_PROVIDER=keenable says so. Otherwise returns null when no provider has a key,
// and with both keys set, Brave answers.
export async function searchTheWeb(query: string, count: number): Promise<WebSearch | null> {
    if (process.env.WEB_SEARCH_PROVIDER === 'keenable') return searchKeenable(query, count)
    return (await searchBrave(query, count)) ?? (await searchKeirolabs(query, count))
}
