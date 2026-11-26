import dns, { type LookupAddress } from 'node:dns'
import { createServer, type Server } from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPublic } from './public-fetch'
import { stackCollector } from './stack'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

const RESOLVED: Record<string, string> = { 'shop.test': '93.184.216.34', 'www.shop.test': '93.184.216.35', 'rebind.test': '93.184.216.36' }

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

describe('stackCollector on a real connection', () => {
    const internalHits: string[] = []
    let internal: Server
    let internalPort = 0

    beforeAll(async () => {
        // The check reads node:dns/promises (public above), the connection node:dns: a rebinding name
        // answers 127.0.0.1 to the second.
        type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
        vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
            const address = isIP(hostname) ? hostname : '127.0.0.1'
            return options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)
        }) as unknown as typeof dns.lookup)
        internal = createServer((req, res) => {
            internalHits.push(`${req.method} ${req.url}`)
            res.writeHead(200, { 'content-type': 'text/html' })
            res.end('<html><head><title>Internal admin</title><meta property="og:site_name" content="INTERNAL-SECRET"></head></html>')
        })
        await new Promise<void>(resolve => internal.listen(0, '127.0.0.1', resolve))
        internalPort = (internal.address() as AddressInfo).port
    })

    afterAll(() => {
        internal.close()
        vi.restoreAllMocks()
    })

    it('brings nothing back from a name that resolves privately at connection time', async () => {
        const input = { url: `http://rebind.test:${internalPort}/`, domain: 'rebind.test', personName: null, email: null, linkedinUrl: null }

        await expect(stackCollector.run({ input, need: async () => null } as never)).rejects.toMatchObject({ cause: { code: 'ENOTPUBLIC' } })
        expect(internalHits).toEqual([])
    })
})
