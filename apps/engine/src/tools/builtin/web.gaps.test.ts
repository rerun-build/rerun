import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-web-gaps-'))

// Hosts in these tests are made up: they resolve to a public address, except the ones named private.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => [{ address: host.startsWith('internal.') ? '10.0.0.7' : '93.184.216.34', family: 4 }],
}))
process.env.RERUN_API_KEY = ''

const { afterEach, describe, expect, it } = await import('vitest')
const { HostBreaker } = await import('../host-breaker.js')
const { workspaceDir } = await import('../../config/paths.js')
const { webTools } = await import('./web.js')

const originalFetch = globalThis.fetch

type FetchMock = ReturnType<typeof vi.fn>

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response): FetchMock {
    const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

function ctxWith(env: Record<string, string> = {}, abortSignal?: AbortSignal) {
    return { agent: { id: 'surfer', env, config: { tools: { paidData: false } } }, sessionId: 's', logger: { warn: () => {} }, hostBreaker: new HostBreaker(), abortSignal } as any
}

// The line saying where the whole page is saved is asserted on its own, in the saved-page tests.
const withoutSavedLine = (text: string): string => text.replace(/\nSaved whole: [^\n]*/, '')

async function call(ctx: ReturnType<typeof ctxWith>, name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<string> {
    return withoutSavedLine((await (webTools(ctx, timeoutMs)[name] as any).execute(args, { toolCallId: 'call-1', messages: [] })) as string)
}

afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('web_fetch', () => {
    it('strips scripts, styles and tags down to readable text', async () => {
        mockFetch(() => new Response('<html><head><style>h1{color:red}</style><script>alert(1)</script></head><body><h1>Hello</h1>\n\n<p>world</p></body></html>'))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/', raw: false })).toBe('[200] https://example.com/\n\nHello world')
    })

    it('puts the page facts of an HTML page before its text', async () => {
        mockFetch(() => new Response('<html lang="es"><head><title>Hola</title><link rel="alternate" hreflang="es" href="/es"></head><body><h1>Hola</h1></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } }))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/', raw: false })).toBe(
            [
                '[200] https://example.com/',
                '',
                'Page facts (HTML as served, before JavaScript):',
                'title: Hola',
                'description: none',
                'canonical: none',
                'robots: X-Robots-Tag: noindex',
                'lang: es',
                'hreflang: es → /es',
                'JSON-LD: none',
                'h1: "Hola"',
                'links: 0 internal, 0 external',
                'nav/header/footer links: none',
                'other internal links: none',
                'visible text: 9 chars',
                '',
                'Hola Hola',
            ].join('\n'),
        )
    })

    it('leaves the facts out of a raw body, a missing page and a non-HTML answer', async () => {
        const html = { 'content-type': 'text/html' }
        mockFetch(() => new Response('<title>Kept</title>', { headers: html }))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/', raw: true })).not.toContain('Page facts')
        mockFetch(() => new Response('<title>Not found</title>', { status: 404, headers: html }))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/x', raw: false })).not.toContain('Page facts')
        mockFetch(() => Response.json({ title: 'x' }))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/api', raw: false })).not.toContain('Page facts')
    })

    it('returns the untouched body when raw is set', async () => {
        mockFetch(() => new Response('<p>kept</p>'))
        expect(await call(ctxWith(), 'web_fetch', { url: 'https://example.com/', raw: true })).toBe('[200] https://example.com/\n\n<p>kept</p>')
    })

    it('caps the returned text at 50 000 characters', async () => {
        mockFetch(() => new Response('a'.repeat(60_000)))
        const text = await call(ctxWith(), 'web_fetch', { url: 'https://example.com/', raw: true })
        expect(text.length).toBe('[200] https://example.com/\n\n'.length + 50_000)
    })

    it('rethrows when the run itself was stopped', async () => {
        const controller = new AbortController()
        controller.abort()
        mockFetch(() => {
            throw new Error('aborted')
        })
        await expect(call(ctxWith({}, controller.signal), 'web_fetch', { url: 'https://example.com/', raw: false })).rejects.toThrow('aborted')
    })
})

describe('web_search', () => {
    it('fails with a readable message when the engine is linked to no hub', async () => {
        const fetchMock = mockFetch(() => Response.json({ results: [] }))
        expect(await call(ctxWith(), 'web_search', { query: 'x', maxResults: 5 })).toBe('Search failed: web search is unavailable: the engine is not linked to a Rerun hub')
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('download', () => {
    it('writes the bytes into the agent workspace, creating folders', async () => {
        const bytes = new Uint8Array([0, 1, 2, 255])
        mockFetch(() => new Response(bytes))
        expect(await call(ctxWith(), 'download', { url: 'https://cdn.test/a.bin', path: 'assets/raw/a.bin' })).toBe('Downloaded 4 bytes to assets/raw/a.bin')
        expect([...(await readFile(resolve(workspaceDir('surfer'), 'assets/raw/a.bin')))]).toEqual([0, 1, 2, 255])
    })

    it('reports an HTTP error and counts a server failure against the host', async () => {
        mockFetch(() => new Response('boom', { status: 503 }))
        expect(await call(ctxWith(), 'download', { url: 'https://cdn.test/a.bin', path: 'a.bin' })).toBe('Download failed: [503] https://cdn.test/a.bin\n\n[attempt 1/3 on cdn.test failed in this run]')
    })

    it('does not count a missing file against the host', async () => {
        mockFetch(() => new Response('nope', { status: 404 }))
        expect(await call(ctxWith(), 'download', { url: 'https://cdn.test/missing.bin', path: 'a.bin' })).toBe('Download failed: [404] https://cdn.test/missing.bin')
    })

    it('refuses a body over 50 MB without writing it', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(50_000_001) })) as unknown as typeof fetch
        expect(await call(ctxWith(), 'download', { url: 'https://cdn.test/huge.bin', path: 'huge.bin' })).toBe('Download too large (50000001 bytes, limit 50MB)')
        await expect(readFile(resolve(workspaceDir('surfer'), 'huge.bin'))).rejects.toThrow()
    })

    it('returns a string on a network error', async () => {
        mockFetch(() => {
            throw new Error('getaddrinfo ENOTFOUND cdn.test')
        })
        expect(await call(ctxWith(), 'download', { url: 'https://cdn.test/a.bin', path: 'a.bin' })).toBe('Download failed: getaddrinfo ENOTFOUND cdn.test (https://cdn.test/a.bin)\n\n[attempt 1/3 on cdn.test failed in this run]')
    })

    it('gives up on a server that never answers', async () => {
        mockFetch((_url, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
        expect(await call(ctxWith(), 'download', { url: 'https://slow.test/a.bin', path: 'a.bin' }, 20)).toContain('Download failed: timed out after 0 s (https://slow.test/a.bin)')
    })

    it('rethrows when the run itself was stopped', async () => {
        const controller = new AbortController()
        controller.abort()
        mockFetch(() => {
            throw new Error('aborted')
        })
        await expect(call(ctxWith({}, controller.signal), 'download', { url: 'https://cdn.test/a.bin', path: 'a.bin' })).rejects.toThrow('aborted')
    })

    it('refuses a destination outside the workspace', async () => {
        mockFetch(() => new Response('x'))
        await expect(call(ctxWith(), 'download', { url: 'https://cdn.test/a.bin', path: '../escape.bin' })).rejects.toThrow('Path escapes the root')
    })
})

describe('web_fetch saving the page', () => {
    async function fetchSaved(url: string, raw = false): Promise<string> {
        return (await (webTools(ctxWith()).web_fetch as any).execute({ url, raw }, { toolCallId: 'call-1', messages: [] })) as string
    }

    it('keeps the HTML as served in the workspace and says where, right under the status', async () => {
        const html = '<html><head><title>Hola</title></head><body><img alt="Iglesia" src="/a.png"><h1>Hola</h1></body></html>'
        mockFetch(() => new Response(html, { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } }))

        const out = await fetchSaved('https://altarflow.test/es')

        expect(out.split('\n').slice(0, 2)).toEqual(['[200] https://altarflow.test/es', 'Saved whole: .rerun/pages/altarflow.test/es.served.html (read or grep it for anything this result leaves out)'])
        expect(await readFile(resolve(workspaceDir('surfer'), '.rerun/pages/altarflow.test/es.served.html'), 'utf8')).toBe(html)
        const meta = JSON.parse(await readFile(resolve(workspaceDir('surfer'), '.rerun/pages/altarflow.test/es.meta.json'), 'utf8'))
        expect(meta.views.served).toMatchObject({ status: 200, contentType: 'text/html', xRobotsTag: 'noindex' })
    })

    it('keeps a robots.txt as text, and the body of a missing page as proof', async () => {
        mockFetch(url => (url.endsWith('robots.txt') ? new Response('User-agent: *\nDisallow: /admin', { headers: { 'content-type': 'text/plain' } }) : new Response('<h1>Not here</h1>', { status: 404, headers: { 'content-type': 'text/html' } })))

        expect(await fetchSaved('https://site.test/robots.txt')).toContain('Saved whole: .rerun/pages/site.test/robots.txt.served.txt')
        expect(await fetchSaved('https://site.test/gone')).toContain('Saved whole: .rerun/pages/site.test/gone.served.html')
        expect(await readFile(resolve(workspaceDir('surfer'), '.rerun/pages/site.test/gone.served.html'), 'utf8')).toBe('<h1>Not here</h1>')
    })

    it('saves the body with raw set too', async () => {
        mockFetch(() => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))

        expect(await fetchSaved('https://api.test/v1', true)).toBe('[200] https://api.test/v1\nSaved whole: .rerun/pages/api.test/v1.served.json (read or grep it for anything this result leaves out)\n\n{"ok":true}')
    })

    it('saves nothing for a binary body', async () => {
        mockFetch(() => new Response('PNG', { headers: { 'content-type': 'image/png' } }))

        expect(await fetchSaved('https://img.test/logo.png')).not.toContain('Saved whole')
    })
})
