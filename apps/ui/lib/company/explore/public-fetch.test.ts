import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPublic } from './public-fetch'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

const RESOLVED: Record<string, string> = { 'shop.test': '93.184.216.34', 'www.shop.test': '93.184.216.35' }

beforeEach(() => {
    mocks.lookup.mockImplementation(async (host: string) => {
        const address = RESOLVED[host]
        if (!address) throw new Error(`ENOTFOUND ${host}`)
        return [{ address, family: 4 }]
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// Answers like the network would, and follows redirects itself when asked to, as Node's fetch does
// with `redirect: 'follow'`: every URL it is sent to is a request that left the server.
function stubSites(pages: Record<string, Response>) {
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
        let url = String(input)
        for (;;) {
            requested.push(url)
            const res = pages[url]?.clone() ?? new Response('not found', { status: 404 })
            const location = res.headers.get('location')
            if (init?.redirect !== 'follow' || !location) return res
            url = new URL(location, url).toString()
        }
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, requested }
}

describe('fetchPublic (company explore)', () => {
    it('sends nothing to a private address a public site redirects to', async () => {
        const { requested } = stubSites({
            'https://shop.test/': new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:18099/internal-admin' } }),
            'http://127.0.0.1:18099/internal-admin': new Response('<title>Internal admin</title>'),
        })

        await expect(fetchPublic('https://shop.test/', { accept: 'text/html', timeoutMs: 5000 })).rejects.toThrow('is not a public host')
        expect(requested).toEqual(['https://shop.test/'])
    })

    it('follows a public redirect chain with its browser headers', async () => {
        const { fetchMock, requested } = stubSites({
            'https://shop.test/': new Response(null, { status: 301, headers: { location: 'https://www.shop.test/' } }),
            'https://www.shop.test/': new Response('<title>Shop</title>', { headers: { 'content-type': 'text/html' } }),
        })

        const res = await fetchPublic('https://shop.test/', { accept: 'text/html', timeoutMs: 5000 })

        expect(await res.text()).toBe('<title>Shop</title>')
        expect(requested).toEqual(['https://shop.test/', 'https://www.shop.test/'])
        const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
        expect(headers.get('accept')).toBe('text/html')
        expect(headers.get('user-agent')).toContain('Mozilla/5.0')
    })
})
