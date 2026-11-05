import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { resolveInWorkspace } from '../sandbox.js'
import { env } from '../../config/env.js'
import { deadlineSignal } from '../../lib/abort.js'
import { NonPublicHostError, fetchPublic } from '../../lib/public-fetch.js'
import { PUBLIC_HTTP_URL_MESSAGE, publicHttpUrl } from '../url.js'
import { HostBreaker, hostOf, isFailureStatus, withHostBreaker, type HostAttempt } from '../host-breaker.js'
import type { RunContext } from '../../runtime/context.js'
import { hubCallerHeaders, type HubCaller } from '../../runtime/hub.js'
import { pageFacts, stripHtml } from './page-facts.js'
import { savePage, textExtension } from './page-file.js'

export const FETCH_TIMEOUT_MS = 30_000
const SEARCH_TIMEOUT_MS = 15_000
const HUB_FETCH_TIMEOUT_MS = 60_000
const MAX_FETCH_CHARS = 50_000
const MAX_REDIRECTS = 10

const USER_AGENT = { 'User-Agent': 'rerun-engine/1.0' }

function failureReason(e: unknown, signal: AbortSignal, timeoutMs: number): string {
    return signal.aborted ? `timed out after ${Math.round(timeoutMs / 1000)} s` : (e as Error).message
}

const refusal = (verb: string, e: NonPublicHostError, url: string): HostAttempt => ({ text: `${verb} refused: ${e.message} (${url}), ${PUBLIC_HTTP_URL_MESSAGE}.`, failed: false })

// What a coworker auditing a site must not read as a fact about it: the status went to our reader,
// from a datacenter with our user agent, and a URL it guessed proves nothing when it does not exist.
function statusLine(status: number, url: string): string {
    if (isFailureStatus(status)) return `[${status}] ${url} (sent to Rerun's reader: not proof that Google or visitors get the same)`
    if (status === 404 || status === 410) return `[${status}] ${url} (no page here: if you guessed this URL instead of following a link, that is not proof of a broken page)`
    return `[${status}] ${url}`
}

function isHtml(res: Response): boolean {
    return (res.headers.get('content-type') ?? '').toLowerCase().includes('html')
}

type SearchResult = { title: string; url: string; snippet: string }

async function searchHub(caller: HubCaller, query: string, maxResults: number): Promise<SearchResult[]> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) throw new Error('web search is unavailable: the engine is not linked to a Rerun hub')

    const res = await fetch(`${hub.replace(/\/$/, '')}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...hubCallerHeaders(caller) },
        body: JSON.stringify({ query, maxResults }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `the Rerun hub answered ${res.status}`)
    }
    const data = (await res.json()) as { results?: SearchResult[] }
    return data.results ?? []
}

function isRefusal(status: number | null): boolean {
    return status === null || status === 403 || status === 429 || status >= 500
}

// Second try for a page the box could not read itself: the hub reads it from a network sites do not
// refuse. Null whenever that does not yield a page, so the caller reports its own failure.
type HubPage = { markdown: string; rawHtml: string | null }

async function fetchThroughHub(caller: HubCaller, url: string, directStatus: number | null, runSignal?: AbortSignal): Promise<HubPage | null> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) return null

    try {
        const res = await fetch(`${hub.replace(/\/$/, '')}/api/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...hubCallerHeaders(caller) },
            body: JSON.stringify({ url, directStatus }),
            signal: deadlineSignal(HUB_FETCH_TIMEOUT_MS, runSignal),
        })
        if (!res.ok) return null
        const data = (await res.json()) as { markdown?: string; rawHtml?: string }
        return data.markdown ? { markdown: data.markdown, rawHtml: data.rawHtml || null } : null
    } catch (e) {
        if (runSignal?.aborted) throw e
        return null
    }
}

const savedLine = (saved: string | null): string => (saved ? `\nSaved whole: ${saved} (read or grep it for anything this result leaves out)` : '')

function saveHubPage(agentId: string, url: string, page: HubPage): Promise<string | null> {
    return savePage(agentId, { url, view: 'rendered', ...(page.rawHtml ? { body: page.rawHtml, ext: 'html' } : { body: page.markdown, ext: 'md' }) })
}

function hubPageText(url: string, note: string, page: HubPage, saved: string | null): string {
    const facts = page.rawHtml ? pageFacts(page.rawHtml, { url, source: 'rendered' }) : null
    return `[200] ${url} ${note}${savedLine(saved)}\n\n${facts ? `${facts}\n\n` : ''}${page.markdown.slice(0, MAX_FETCH_CHARS)}`
}

const WEB_FETCH_DESCRIPTION =
    'Fetch a URL and return its text content (HTML is stripped to plain text). An HTML page starts with its page facts as the site serves them, before JavaScript: title, meta description, canonical, robots, hreflang, JSON-LD types, h1 and links, including those of the navigation and footer. Every page read is also saved whole under .rerun/pages/ in your workspace, to grep for anything the result leaves out.'

const webSearchDescription = (paidData: boolean): string => `Search the web and return ranked results (title, URL, snippet). Use this to discover sources before fetching them.${paidData ? ' For people and their work emails or phones, lists of companies, social profiles and posts, SEO numbers or Google and Maps rows, use paid_data instead: it returns that as structured, verified rows, where a web search only finds pages that may mention it.' : ''}`

export function webTools(ctx: RunContext, fetchTimeoutMs = FETCH_TIMEOUT_MS): ToolSet {
    const id = ctx.agent.id
    const breaker = ctx.hostBreaker ?? new HostBreaker()
    const hostsOfUrl = (url: string) => {
        const host = hostOf(url)
        return host ? [host] : []
    }
    return {
        web_fetch: tool({
            description: WEB_FETCH_DESCRIPTION,
            inputSchema: z.object({ url: publicHttpUrl, raw: z.boolean().default(false).describe('Return raw body instead of stripped text') }),
            execute: async ({ url, raw }, { abortSignal }) =>
                withHostBreaker(breaker, hostsOfUrl(url), async (): Promise<HostAttempt> => {
                    const runSignal = ctx.abortSignal ?? abortSignal
                    const signal = deadlineSignal(fetchTimeoutMs, runSignal)
                    let directStatus: number | null = null
                    let direct: HostAttempt
                    try {
                        const res = await fetchPublic(url, { headers: USER_AGENT, signal }, { maxRedirects: MAX_REDIRECTS })
                        const body = await res.text()
                        directStatus = res.status
                        const finalUrl = res.url || url
                        const xRobotsTag = res.headers.get('x-robots-tag')
                        const facts =
                            !raw && res.status < 400 && isHtml(res)
                                ? pageFacts(body, { url, source: 'served', xRobotsTag, redirectedTo: finalUrl !== url ? finalUrl : null })
                                : null
                        const contentType = res.headers.get('content-type')
                        const ext = textExtension(contentType)
                        const saved = ext ? await savePage(id, { url, view: 'served', body, ext, status: res.status, finalUrl, contentType, xRobotsTag }) : null
                        const text = raw ? body : stripHtml(body)
                        direct = { text: `${statusLine(res.status, url)}${savedLine(saved)}\n\n${facts ? `${facts}\n\n` : ''}${text.slice(0, MAX_FETCH_CHARS)}`, failed: isFailureStatus(res.status) }
                    } catch (e) {
                        if (runSignal?.aborted) throw e
                        if (e instanceof NonPublicHostError) return refusal('Fetch', e, url)
                        direct = { text: `Fetch failed: ${failureReason(e, signal, fetchTimeoutMs)} (${url}). This is Rerun's reader failing, not proof that the site is down.`, failed: true }
                    }
                    if (raw || !isRefusal(directStatus)) return direct

                    const page = await fetchThroughHub(ctx.agent, url, directStatus, runSignal)
                    if (!page) return direct
                    const note =
                        directStatus === null
                            ? "(read through Rerun: Rerun's reader could not reach the site directly, not proof that the site is down)"
                            : `(read through Rerun: the site answered ${directStatus} to Rerun's reader, not proof that Google or visitors get the same)`
                    return { text: hubPageText(url, note, page, await saveHubPage(id, url, page)), failed: false }
                }),
        }),
        web_search: tool({
            description: webSearchDescription(ctx.agent.config.tools.paidData),
            inputSchema: z.object({ query: z.string(), maxResults: z.number().int().positive().max(20).default(5) }),
            execute: async ({ query, maxResults }) => {
                try {
                    const results = await searchHub(ctx.agent, query, maxResults)
                    if (results.length === 0) return 'No results.'
                    return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n\n')
                } catch (e) {
                    return `Search failed: ${(e as Error).message}`
                }
            },
        }),
        download: tool({
            description: 'Download a URL into your workspace as a file (binary-safe). Use for assets you want to process locally.',
            inputSchema: z.object({ url: publicHttpUrl, path: z.string().describe('Workspace-relative destination path') }),
            execute: async ({ url, path }, { abortSignal }) =>
                withHostBreaker(breaker, hostsOfUrl(url), async (): Promise<HostAttempt> => {
                    const runSignal = ctx.abortSignal ?? abortSignal
                    const signal = deadlineSignal(fetchTimeoutMs, runSignal)
                    let res: Response
                    try {
                        res = await fetchPublic(url, { headers: USER_AGENT, signal }, { maxRedirects: MAX_REDIRECTS })
                    } catch (e) {
                        if (runSignal?.aborted) throw e
                        if (e instanceof NonPublicHostError) return refusal('Download', e, url)
                        return { text: `Download failed: ${failureReason(e, signal, fetchTimeoutMs)} (${url})`, failed: true }
                    }
                    if (!res.ok) return { text: `Download failed: [${res.status}] ${url}`, failed: isFailureStatus(res.status) }
                    const buffer = Buffer.from(await res.arrayBuffer())
                    if (buffer.byteLength > 50_000_000) return { text: `Download too large (${buffer.byteLength} bytes, limit 50MB)`, failed: false }
                    const target = await resolveInWorkspace(id, path)
                    await mkdir(dirname(target), { recursive: true })
                    await writeFile(target, buffer)
                    return { text: `Downloaded ${buffer.byteLength} bytes to ${path}`, failed: false }
                }),
        }),
    }
}
