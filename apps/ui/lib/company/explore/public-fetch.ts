import { fetchPublic as fetchCheckedPublic } from '@/lib/net/public-fetch'

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
// http -> https -> www -> a language prefix: the longest chain a real company site takes.
const MAX_REDIRECTS = 5

// These fetches run from our own servers, unlike the Firecrawl calls: every hop of a redirect is
// checked, so a public site cannot bounce the lab onto a private address of our network.
export async function fetchPublic(url: string, { accept, timeoutMs }: { accept: string; timeoutMs: number }): Promise<Response> {
    return fetchCheckedPublic(url, { headers: { 'user-agent': BROWSER_USER_AGENT, accept } }, { timeoutMs, maxRedirects: MAX_REDIRECTS })
}
