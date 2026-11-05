import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { z } from 'zod'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-web-'))
process.env.RERUN_API_KEY = ''

// Hosts in these tests are made up: they resolve to a public address, except the ones named private.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => [{ address: host.startsWith('internal.') ? '10.0.0.7' : '93.184.216.34', family: 4 }],
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { HostBreaker, BLOCKED_SOURCE_PREFIX } = await import('../host-breaker.js')
const { webTools } = await import('./web.js')
const { workspaceDir } = await import('../../config/paths.js')

const originalFetch = globalThis.fetch

function ctxWith() {
    return { agent: { id: 'surfer', env: {}, config: { tools: { paidData: false } } }, sessionId: 's', logger: { warn: () => {} }, hostBreaker: new HostBreaker() } as any
}

// The line saying where the whole page is saved is asserted on its own, in the saved-page tests.
const withoutSavedLine = (text: string): string => text.replace(/\nSaved whole: [^\n]*/, '')

async function fetchPage(ctx: ReturnType<typeof ctxWith>, url: string, timeoutMs?: number): Promise<string> {
    return withoutSavedLine((await (webTools(ctx, timeoutMs).web_fetch as any).execute({ url, raw: false }, { toolCallId: 'call-1', messages: [] })) as string)
}

const inputSchema = (name: string) => (webTools(ctxWith())[name] as any).inputSchema as z.ZodTypeAny

// A Response built by hand has no url; a real fetch reports the one of the hop it ended on.
function responseAt(url: string, body: string, init?: ResponseInit): Response {
    const res = new Response(body, init)
    Object.defineProperty(res, 'url', { value: url })
    return res
}

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('web_search description', () => {
    it('points at paid_data for people and company data only when the coworker can buy it', () => {
        const withPaidData = (webTools({ ...ctxWith(), agent: { id: 'surfer', env: {}, config: { tools: { paidData: true } } } }).web_search as any).description as string
        expect(withPaidData).toContain('use paid_data instead')
        expect(withPaidData.length).toBeLessThan(1000)
        expect((webTools(ctxWith()).web_search as any).description).not.toContain('paid_data')
    })
})

describe('web_fetch', () => {
    it.each(['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)'])('refuses %s in its schema, so the model is told before anything runs', url => {
        const result = inputSchema('web_fetch').safeParse({ url, raw: true })
        expect(result.success).toBe(false)
        expect(JSON.stringify(result.error?.issues)).toContain('only http and https URLs on public hosts are accepted')
        expect(inputSchema('web_fetch').safeParse({ url: 'https://example.com/', raw: true }).success).toBe(true)
    })

    it.each(['file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://internal.test/admin'])('refuses %s without fetching, as a result the model reads and not an exception', async url => {
        const fetchMock = vi.fn()
        globalThis.fetch = fetchMock as unknown as typeof fetch
        const out = await fetchPage(ctxWith(), url)
        expect(out).toMatch(/^Fetch refused: .* is not a public host \(.*\), only http and https URLs on public hosts are accepted\.$/)
        expect(out).not.toContain('failed in this run')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a redirect from a public host to a private one, and does not follow it', async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
        globalThis.fetch = fetchMock as unknown as typeof fetch
        expect(await fetchPage(ctxWith(), 'https://example.com/go')).toBe('Fetch refused: 169.254.169.254 is not a public host (https://example.com/go), only http and https URLs on public hosts are accepted.')
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual', headers: { 'User-Agent': 'rerun-engine/1.0' } })
    })

    it('follows a redirect between public hosts and reports where it landed', async () => {
        const fetchMock = vi.fn(async (url: string) =>
            url === 'https://example.com/old'
                ? new Response(null, { status: 301, headers: { location: 'https://www.example.com/new' } })
                : responseAt('https://www.example.com/new', '<html><head><title>New</title></head><body><h1>New</h1></body></html>', { headers: { 'content-type': 'text/html' } }),
        )
        globalThis.fetch = fetchMock as unknown as typeof fetch
        const out = await fetchPage(ctxWith(), 'https://example.com/old')
        expect(out).toContain('[200] https://example.com/old')
        expect(out).toContain('redirected to: https://www.example.com/new')
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://example.com/old', 'https://www.example.com/new'])
    })

    it('closes a host after three refused attempts and stops fetching it', async () => {
        const fetchMock = vi.fn(async () => new Response('<h1>Forbidden</h1>', { status: 403 }))
        globalThis.fetch = fetchMock as unknown as typeof fetch
        const ctx = ctxWith()
        expect(await fetchPage(ctx, 'https://www.reddit.com/r/startups.json')).toContain('[attempt 1/3 on reddit.com failed in this run]')
        await fetchPage(ctx, 'https://reddit.com/r/startups')
        expect(await fetchPage(ctx, 'https://www.reddit.com/r/startups')).toContain(BLOCKED_SOURCE_PREFIX)
        expect(await fetchPage(ctx, 'https://reddit.com/r/startups')).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX} reddit.com`))
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(await fetchPage(ctx, 'https://old.reddit.com/r/startups')).toContain('[attempt 1/3 on old.reddit.com failed in this run]')
    })

    it('returns a string instead of throwing on a network error', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('getaddrinfo ENOTFOUND nowhere.test')
        }) as unknown as typeof fetch
        expect(await fetchPage(ctxWith(), 'https://nowhere.test/')).toBe("Fetch failed: getaddrinfo ENOTFOUND nowhere.test (https://nowhere.test/). This is Rerun's reader failing, not proof that the site is down.\n\n[attempt 1/3 on nowhere.test failed in this run]")
    })

    it('gives up on a fetch that never answers', async () => {
        globalThis.fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch
        expect(await fetchPage(ctxWith(), 'https://slow.test/page', 50)).toContain('Fetch failed: timed out after 0 s (https://slow.test/page)')
    })

    it('says that a refusal went to Rerun, not to Google', async () => {
        globalThis.fetch = vi.fn(async () => new Response('denied', { status: 403 })) as unknown as typeof fetch
        expect(await fetchPage(ctxWith(), 'https://repeg.test/')).toMatch(/^\[403\] https:\/\/repeg\.test\/ \(sent to Rerun's reader: not proof that Google or visitors get the same\)\n\ndenied/)
    })

    it('does not count a missing page against the host', async () => {
        globalThis.fetch = vi.fn(async () => new Response('gone', { status: 404 })) as unknown as typeof fetch
        expect(await fetchPage(ctxWith(), 'https://example.com/missing')).toBe('[404] https://example.com/missing (no page here: if you guessed this URL instead of following a link, that is not proof of a broken page)\n\ngone')
    })
})

describe('download', () => {
    it('refuses a private host without fetching nor writing anything', async () => {
        const fetchMock = vi.fn()
        globalThis.fetch = fetchMock as unknown as typeof fetch
        const out = await (webTools(ctxWith()).download as any).execute({ url: 'http://127.0.0.1:9/loot', path: 'loot.txt' }, { toolCallId: 'call-1', messages: [] })
        expect(out).toBe('Download refused: 127.0.0.1:9 is not a public host (http://127.0.0.1:9/loot), only http and https URLs on public hosts are accepted.')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(existsSync(resolve(workspaceDir('surfer'), 'loot.txt'))).toBe(false)
    })

    it('refuses a redirect to a private host', async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/' } }))
        globalThis.fetch = fetchMock as unknown as typeof fetch
        const out = await (webTools(ctxWith()).download as any).execute({ url: 'https://cdn.example.com/a.bin', path: 'a.bin' }, { toolCallId: 'call-1', messages: [] })
        expect(out).toMatch(/^Download refused: 10\.0\.0\.5 is not a public host/)
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('refuses file URLs in its schema', () => {
        expect(inputSchema('download').safeParse({ url: 'file:///etc/shadow', path: 'x' }).success).toBe(false)
    })
})
