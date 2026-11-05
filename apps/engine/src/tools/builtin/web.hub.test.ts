import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-web-hub-'))

// Hosts in these tests are made up: they resolve to a public address, except the ones named private.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => [{ address: host.startsWith('internal.') ? '10.0.0.7' : '93.184.216.34', family: 4 }],
}))
process.env.RERUN_API_KEY = 'engine-secret'
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.test/'

const { afterEach, describe, expect, it } = await import('vitest')
const { HostBreaker } = await import('../host-breaker.js')
const { workspaceDir } = await import('../../config/paths.js')
const { webTools } = await import('./web.js')
const { FOREMAN_HUB_TOKEN_HEADER } = await import('@rerun/contracts')

const originalFetch = globalThis.fetch

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

function ctxWith(env: Record<string, string> = {}) {
    return { agent: { id: 'surfer', env, config: { tools: { paidData: false } } }, sessionId: 's', logger: { warn: () => {} }, hostBreaker: new HostBreaker() } as any
}

// The line saying where the whole page is saved is asserted on its own, in the saved-page tests.
const withoutSavedLine = (text: string): string => text.replace(/\nSaved whole: [^\n]*/, '')

async function search(ctx: ReturnType<typeof ctxWith>, args: Record<string, unknown>): Promise<string> {
    return (await (webTools(ctx).web_search as any).execute(args, { toolCallId: 'call-1', messages: [] })) as string
}

async function fetchPage(ctx: ReturnType<typeof ctxWith>, url: string, raw = false): Promise<string> {
    return withoutSavedLine((await (webTools(ctx).web_fetch as any).execute({ url, raw }, { toolCallId: 'call-1', messages: [] })) as string)
}

const HUB_FETCH_URL = 'https://hub.example.test/api/fetch'

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('web_fetch falling back to the hub', () => {
    it('never asks the hub for a private host it refused itself', async () => {
        const fetchMock = mockFetch(() => Response.json({ markdown: 'leaked' }))

        expect(await fetchPage(ctxWith(), 'http://127.0.0.1:8080/admin')).toMatch(/^Fetch refused: 127\.0\.0\.1:8080 is not a public host/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('asks the hub for a page the site refused, and does not count the host as failed', async () => {
        const fetchMock = mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ markdown: '# Reviews' }) : new Response('<h1>Forbidden</h1>', { status: 403 })))

        expect(await fetchPage(ctxWith(), 'https://www.g2.com/products/slack')).toBe("[200] https://www.g2.com/products/slack (read through Rerun: the site answered 403 to Rerun's reader, not proof that Google or visitors get the same)\n\n# Reviews")
        const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
        expect(url).toBe(HUB_FETCH_URL)
        expect(init.headers).toMatchObject({ Authorization: 'Bearer engine-secret', 'x-rerun-agent': 'surfer' })
        expect(JSON.parse(String(init.body))).toEqual({ url: 'https://www.g2.com/products/slack', directStatus: 403 })
    })

    it('asks the hub when the site could not be reached at all', async () => {
        const fetchMock = mockFetch(url => {
            if (url === HUB_FETCH_URL) return Response.json({ markdown: 'page' })
            throw new Error('ECONNRESET')
        })

        expect(await fetchPage(ctxWith(), 'https://shy.test/')).toBe("[200] https://shy.test/ (read through Rerun: Rerun's reader could not reach the site directly, not proof that the site is down)\n\npage")
        expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ url: 'https://shy.test/', directStatus: null })
    })

    it('reports the direct refusal when the hub cannot read the page either', async () => {
        mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ error: 'The page could not be read' }, { status: 502 }) : new Response('nope', { status: 403 })))

        expect(await fetchPage(ctxWith(), 'https://yelp.com/biz/x')).toBe("[403] https://yelp.com/biz/x (sent to Rerun's reader: not proof that Google or visitors get the same)\n\nnope\n\n[attempt 1/3 on yelp.com failed in this run]")
    })

    it('reports the direct refusal when the hub cannot be reached', async () => {
        mockFetch(url => {
            if (url === HUB_FETCH_URL) throw new Error('ECONNRESET')
            return new Response('nope', { status: 429 })
        })

        expect(await fetchPage(ctxWith(), 'https://busy.test/')).toContain("[429] https://busy.test/ (sent to Rerun's reader: not proof that Google or visitors get the same)\n\nnope")
    })

    it('leaves a page that answered, a missing page and a login wall to the direct fetch', async () => {
        for (const status of [200, 404, 401]) {
            const fetchMock = mockFetch(() => new Response('body', { status }))

            expect(await fetchPage(ctxWith(), 'https://example.com/page')).toContain(`[${status}] https://example.com/page`)
            expect(fetchMock).toHaveBeenCalledTimes(1)
        }
    })

    it('never asks the hub for a raw body', async () => {
        const fetchMock = mockFetch(() => new Response('{"error":"forbidden"}', { status: 403 }))

        expect(await fetchPage(ctxWith(), 'https://api.example.com/v1', true)).toContain(`[403] https://api.example.com/v1 (sent to Rerun's reader: not proof that Google or visitors get the same)\n\n{"error":"forbidden"}`)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('puts the facts of the rendered HTML the hub returns before its markdown', async () => {
        mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ markdown: '# Reviews', rawHtml: '<html lang="en"><head><title>Slack reviews</title></head></html>' }) : new Response('nope', { status: 403 })))

        const text = await fetchPage(ctxWith(), 'https://www.g2.com/products/slack')

        expect(text).toMatch(/^\[200\] https:\/\/www\.g2\.com\/products\/slack \(read through Rerun: the site answered 403 to Rerun's reader, not proof that Google or visitors get the same\)\n\nPage facts \(HTML after JavaScript, read through Rerun\):\ntitle: Slack reviews\n/)
        expect(text).toMatch(/\n\n# Reviews$/)
    })
})

describe('web_fetch saving the hub page', () => {
    it('keeps the rendered HTML next to the served one and says where', async () => {
        const rendered = '<html><body><nav><a href="/comparescreeners.html">Compare</a></nav></body></html>'
        let refuse = false
        mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ markdown: '# Mometic', rawHtml: rendered }) : refuse ? new Response('nope', { status: 403 }) : new Response('<html><body>served</body></html>', { headers: { 'content-type': 'text/html' } })))

        await fetchPage(ctxWith(), 'https://mometic.test/')
        refuse = true
        const out = (await (webTools(ctxWith()).web_fetch as any).execute({ url: 'https://mometic.test/', raw: false }, { toolCallId: 'call-1', messages: [] })) as string

        expect(out).toContain("(read through Rerun: the site answered 403 to Rerun's reader, not proof that Google or visitors get the same)\nSaved whole: .rerun/pages/mometic.test/index.rendered.html")
        const dir = resolve(workspaceDir('surfer'), '.rerun/pages/mometic.test')
        expect(await readFile(resolve(dir, 'index.rendered.html'), 'utf8')).toBe(rendered)
        expect(await readFile(resolve(dir, 'index.served.html'), 'utf8')).toBe('<html><body>served</body></html>')
    })

    it('keeps the markdown when the hub sends no HTML', async () => {
        mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ markdown: '# Reviews' }) : new Response('nope', { status: 403 })))

        const out = (await (webTools(ctxWith()).web_fetch as any).execute({ url: 'https://refuser.test/reviews', raw: false }, { toolCallId: 'call-1', messages: [] })) as string

        expect(out).toContain("(read through Rerun: the site answered 403 to Rerun's reader, not proof that Google or visitors get the same)\nSaved whole: .rerun/pages/refuser.test/reviews.rendered.md")
        expect(await readFile(resolve(workspaceDir('surfer'), '.rerun/pages/refuser.test/reviews.rendered.md'), 'utf8')).toBe('# Reviews')
    })
})

describe('web_search through the hub', () => {
    it('asks the hub with the engine key and the coworker id, and formats the results', async () => {
        const fetchMock = mockFetch(() =>
            Response.json({
                results: [
                    { title: 'One', url: 'https://one.test', snippet: 'first' },
                    { title: 'Two', url: 'https://two.test', snippet: '' },
                ],
            }),
        )

        expect(await search(ctxWith(), { query: 'a & b', maxResults: 2 })).toBe('1. One\n   https://one.test\n   first\n\n2. Two\n   https://two.test')
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://hub.example.test/api/search')
        expect(init.method).toBe('POST')
        expect(init.headers).toMatchObject({ Authorization: 'Bearer engine-secret', 'x-rerun-agent': 'surfer' })
        expect(JSON.parse(String(init.body))).toEqual({ query: 'a & b', maxResults: 2 })
    })

    it('ignores a search key left in the coworker env', async () => {
        const fetchMock = mockFetch(() => Response.json({ results: [] }))

        await search(ctxWith({ TAVILY_API_KEY: 'tv-key', BRAVE_API_KEY: 'br-key' }), { query: 'rerun', maxResults: 5 })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toBe('https://hub.example.test/api/search')
    })

    it('says so when a search comes back empty', async () => {
        mockFetch(() => Response.json({ results: [] }))

        expect(await search(ctxWith(), { query: 'nothing', maxResults: 5 })).toBe('No results.')
    })

    it('reports the reason the hub gives when it refuses', async () => {
        mockFetch(() => Response.json({ error: 'The search provider failed (429)' }, { status: 502 }))

        expect(await search(ctxWith(), { query: 'x', maxResults: 5 })).toBe('Search failed: The search provider failed (429)')
    })

    it('reports the status when the hub answers without a reason', async () => {
        mockFetch(() => new Response('Bad gateway', { status: 504 }))

        expect(await search(ctxWith(), { query: 'x', maxResults: 5 })).toBe('Search failed: the Rerun hub answered 504')
    })

    it('returns a string instead of throwing when the hub cannot be reached', async () => {
        mockFetch(() => {
            throw new Error('ECONNRESET')
        })

        expect(await search(ctxWith(), { query: 'x', maxResults: 5 })).toBe('Search failed: ECONNRESET')
    })
})

describe('the foreman token on the hub routes', () => {
    const foremanCtx = () => ({ ...ctxWith(), agent: { id: 'foreman', env: {}, config: { tools: { paidData: false } }, brief: { instructions: 'x', tools: [], hubToken: 'signed-by-hub' } } }) as any

    it('rides along on a search and on a page read through the hub', async () => {
        const fetchMock = mockFetch(url => (url === HUB_FETCH_URL ? Response.json({ markdown: 'page' }) : url.endsWith('/api/search') ? Response.json({ results: [] }) : new Response('', { status: 403 })))

        await search(foremanCtx(), { query: 'rerun', maxResults: 1 })
        await fetchPage(foremanCtx(), 'https://www.g2.com/products/slack')

        const hubCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://hub.example.test/'))
        expect(hubCalls.map(([url]) => url)).toEqual(['https://hub.example.test/api/search', HUB_FETCH_URL])
        for (const [, init] of hubCalls) expect(init?.headers).toMatchObject({ 'x-rerun-agent': 'foreman', [FOREMAN_HUB_TOKEN_HEADER]: 'signed-by-hub' })
    })

    it('is absent for a coworker, which has no brief', async () => {
        const fetchMock = mockFetch(() => Response.json({ results: [] }))

        await search(ctxWith(), { query: 'rerun', maxResults: 1 })

        expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).not.toHaveProperty(FOREMAN_HUB_TOKEN_HEADER)
    })
})
