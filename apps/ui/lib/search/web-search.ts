import { searchBrave } from '@/lib/search/brave'
import { searchKeirolabs } from '@/lib/search/keirolabs'

export type WebSearchResult = { title: string; url: string; snippet: string }

export type WebSearch = { status: number | null; ok: boolean; results: WebSearchResult[] }

export const WEB_SEARCH_PAGE_SIZE = 20

export async function searchTheWeb(query: string, count: number): Promise<WebSearch | null> {
    return (await searchBrave(query, count)) ?? (await searchKeirolabs(query, count))
}
