import { platformHost } from '@rerun/contracts'

import { normalizeDomain } from '@/lib/services/brand-icon'

const FIRECRAWL_BASE_URL = process.env.RERUN_FIRECRAWL_BASE_URL ?? 'https://api.firecrawl.dev'
const SCRAPE_TIMEOUT_MS = 20_000
// A landing page's main content is well under this; the cap is there so a documentation-heavy
// home page cannot push a 200k prompt into the analysis model.
const MAX_MARKDOWN = 15_000

// Hosts a scrape must never be pointed at. Firecrawl runs the request from its own network, so
// this is not an SSRF guard for us — it is what keeps someone's `localhost:3000` from being sent
// to a third party and billed as a page.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i

// The onboarding field takes whatever people type: "acme.com", "www.acme.com/fr", a full URL.
// Returns null when there is nothing that could be a public site, which is the signal to skip the
// analysis entirely rather than spend a scrape on it. A platform (linkedin.com, facebook.com) is
// never a company's site: reading it would describe the platform.
export function companySiteUrl(input: string): string | null {
    const domain = normalizeDomain(input)
    if (!domain.includes('.') || PRIVATE_HOST.test(domain) || platformHost(domain)) return null
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null
    return `https://${domain}`
}

// What a coworker's web_fetch may hand to the scraper: any public http(s) page, path included.
export function isPublicUrl(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url)
        return (protocol === 'https:' || protocol === 'http:') && hostname.includes('.') && !PRIVATE_HOST.test(hostname)
    } catch {
        return false
    }
}

// The plan's ceiling is a per-minute request count, and its reset is on the order of a second, so
// one wait is the difference between a signup spike degrading to the generic connector list and it
// simply being served a moment later. One retry only: past that the person is waiting on a screen.
const RATE_LIMIT_RETRY_MS = 1500

// Reads a company's home page as markdown. Never throws: every failure (no key, timeout, quota,
// a site that blocks crawlers) degrades to null, and the caller falls back to the generic
// connector list rather than showing an error in the middle of the onboarding.
export async function scrapeCompanySite(url: string): Promise<string | null> {
    if (!process.env.FIRECRAWL_API_KEY) return null

    try {
        const body = await firecrawl<{ data?: { markdown?: string } }>('/v2/scrape', { url, formats: ['markdown'], onlyMainContent: true })
        const markdown = body.data?.markdown?.trim()
        return markdown ? markdown.slice(0, MAX_MARKDOWN) : null
    } catch {
        return null
    }
}

// Raw Firecrawl call for the callers that want to know why it failed (the company explorers show
// the error next to the source). Same single retry on a rate limit as the onboarding scrape.
export async function firecrawl<T>(path: string, body: Record<string, unknown>, timeoutMs = SCRAPE_TIMEOUT_MS): Promise<T> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured')

    const res = await requestFirecrawlPastRateLimit(path, body, apiKey, timeoutMs)
    if (!res.ok) throw new Error(`Firecrawl ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as T
}

const PAGE_TIMEOUT_MS = 45_000

// `status` is Firecrawl's own answer, null when it could not be reached. `pageStatus` is what the
// site answered to Firecrawl: a block page it rendered faithfully is still a failed read. `rawHtml` is
// the page after its JavaScript ran, head included, which the markdown leaves out.
export type PageScrape = { status: number | null; ok: boolean; markdown: string; rawHtml: string; pageStatus: number | null }

// Reads any public page as markdown, for a coworker whose own fetch was refused. Returns null when
// no key is configured. `proxy: 'auto'` only reaches for the stealth proxy (5 credits instead of 1)
// after the basic one failed.
export async function scrapePage(url: string): Promise<PageScrape | null> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) return null

    try {
        const res = await requestFirecrawlPastRateLimit('/v2/scrape', { url, formats: ['markdown', 'rawHtml'], proxy: 'auto' }, apiKey, PAGE_TIMEOUT_MS)
        if (!res.ok) return { status: res.status, ok: false, markdown: '', rawHtml: '', pageStatus: null }

        const body = (await res.json()) as { data?: { markdown?: string; rawHtml?: string; metadata?: { statusCode?: number } } }
        const pageStatus = body.data?.metadata?.statusCode ?? null
        return { status: res.status, ok: pageStatus === null || pageStatus < 400, markdown: body.data?.markdown?.trim() ?? '', rawHtml: body.data?.rawHtml ?? '', pageStatus }
    } catch {
        return { status: null, ok: false, markdown: '', rawHtml: '', pageStatus: null }
    }
}

async function requestFirecrawlPastRateLimit(path: string, body: Record<string, unknown>, apiKey: string, timeoutMs: number): Promise<Response> {
    const res = await requestFirecrawl(path, body, apiKey, timeoutMs)
    if (res.status !== 429) return res
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RETRY_MS))
    return requestFirecrawl(path, body, apiKey, timeoutMs)
}

function requestFirecrawl(path: string, body: Record<string, unknown>, apiKey: string, timeoutMs: number): Promise<Response> {
    return fetch(`${FIRECRAWL_BASE_URL}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    })
}
