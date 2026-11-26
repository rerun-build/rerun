import dns, { type LookupAddress } from 'node:dns'
import { createServer, type Server } from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertPublicUrl, fetchPublic, publicOnlyLookup, resolvesToPublicAddresses } from './public-fetch'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

const RESOLVED: Record<string, string> = {
    'public.test': '93.184.216.34',
    'cdn.public.test': '93.184.216.35',
    'internal.test': '10.0.0.7',
    'metadata.test': '169.254.169.254',
    'rebind.test': '93.184.216.36',
}

// What the connection reads, apart from the check above: a rebinding name answers public to the
// check and private here.
const CONNECT_RESOLVED: Record<string, LookupAddress[]> = {
    'public.test': [{ address: '93.184.216.34', family: 4 }],
    'dual.test': [
        { address: '2606:2800:220:1::1', family: 6 },
        { address: '93.184.216.34', family: 4 },
    ],
    'mixed.test': [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.7', family: 4 },
    ],
    'rebind.test': [{ address: '127.0.0.1', family: 4 }],
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : CONNECT_RESOLVED[hostname]
    if (!addresses) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), '')
    if (options.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
}) as unknown as typeof dns.lookup)

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

describe('resolvesToPublicAddresses', () => {
    it.each(['127.0.0.1', '[::1]', '169.254.169.254', '100.64.0.1', '::ffff:10.0.0.1', '[::ffff:10.0.0.1]', 'internal.test', 'metadata.test', 'unknown.test'])('refuses %s', async host => {
        expect(await resolvesToPublicAddresses(host)).toBe(false)
    })

    it('accepts a name that resolves to a public address', async () => {
        expect(await resolvesToPublicAddresses('public.test')).toBe(true)
    })
})

describe('assertPublicUrl', () => {
    it.each(['http://127.0.0.1:8080/mcp', 'http://[::ffff:10.0.0.1]/', 'https://metadata.test/latest', 'file:///etc/passwd'])('refuses %s', async url => {
        await expect(assertPublicUrl(url)).rejects.toThrow('is not a public host')
    })

    it('hands back the parsed URL of a public host', async () => {
        expect((await assertPublicUrl('https://public.test/x')).hostname).toBe('public.test')
    })
})

describe('fetchPublic', () => {
    function stubFetch(responses: Record<string, Response>) {
        const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(async input => responses[String(input)] ?? new Response('not found', { status: 404 }))
        vi.stubGlobal('fetch', fetchMock)
        return fetchMock
    }

    it('never fetches a private host', async () => {
        const fetchMock = stubFetch({})

        await expect(fetchPublic('http://internal.test/')).rejects.toThrow('internal.test is not a public host')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('follows a GET redirect to a public host, checking the hop', async () => {
        const fetchMock = stubFetch({
            'https://public.test/a': new Response(null, { status: 302, headers: { location: 'https://cdn.public.test/b' } }),
            'https://cdn.public.test/b': Response.json({ ok: true }),
        })

        const res = await fetchPublic('https://public.test/a')

        expect(await res.json()).toEqual({ ok: true })
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://public.test/a', 'https://cdn.public.test/b'])
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
        expect(fetchMock.mock.calls.every(([, init]) => (init as { dispatcher?: unknown } | undefined)?.dispatcher)).toBe(true)
    })

    it('releases the body of a redirect it follows', async () => {
        const cancel = vi.fn()
        stubFetch({
            'https://public.test/a': new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: 'https://cdn.public.test/b' } }),
            'https://cdn.public.test/b': Response.json({ ok: true }),
        })

        await fetchPublic('https://public.test/a')

        expect(cancel).toHaveBeenCalledOnce()
    })

    it('refuses a GET redirect to a private host', async () => {
        const fetchMock = stubFetch({ 'https://public.test/a': new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }) })

        await expect(fetchPublic('https://public.test/a')).rejects.toThrow('is not a public host')
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('does not follow a POST redirect', async () => {
        const fetchMock = stubFetch({ 'https://public.test/token': new Response(null, { status: 307, headers: { location: 'https://cdn.public.test/token' } }) })

        const res = await fetchPublic('https://public.test/token', { method: 'POST', body: 'code=1' })

        expect(res.status).toBe(307)
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('stops after the last allowed hop and hands back the redirect', async () => {
        const fetchMock = stubFetch({
            'https://public.test/a': new Response(null, { status: 302, headers: { location: 'https://public.test/b' } }),
            'https://public.test/b': new Response(null, { status: 302, headers: { location: 'https://public.test/a' } }),
        })

        const res = await fetchPublic('https://public.test/a', {}, { maxRedirects: 1 })

        expect(res.status).toBe(302)
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

describe('publicOnlyLookup', () => {
    function lookupOf(hostname: string, all: boolean) {
        return new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>(resolve =>
            publicOnlyLookup(hostname, { all }, (err, address, family) => resolve({ err, address, family }))
        )
    }

    it('hands back a public address, alone or as the whole list', async () => {
        expect(await lookupOf('public.test', false)).toEqual({ err: null, address: '93.184.216.34', family: 4 })
        expect((await lookupOf('dual.test', true)).address).toEqual(CONNECT_RESOLVED['dual.test'])
    })

    it.each(['rebind.test', 'mixed.test'])('refuses %s, which resolves to a private address', async hostname => {
        for (const all of [false, true]) expect((await lookupOf(hostname, all)).err).toMatchObject({ code: 'ENOTPUBLIC' })
    })

    it('passes a resolution error through', async () => {
        expect((await lookupOf('unknown.test', false)).err).toMatchObject({ code: 'ENOTFOUND' })
    })
})

describe('fetchPublic on a real connection', () => {
    const internalHits: string[] = []
    let internal: Server
    let internalPort = 0

    beforeAll(async () => {
        internal = createServer((req, res) => {
            internalHits.push(`${req.method} ${req.url}`)
            res.end('<title>Internal admin</title>')
        })
        await new Promise<void>(resolve => internal.listen(0, '127.0.0.1', resolve))
        internalPort = (internal.address() as AddressInfo).port
    })

    afterAll(() => {
        internal.close()
    })

    it('never connects to a name that resolves privately once the check has passed', async () => {
        await expect(fetchPublic(`http://rebind.test:${internalPort}/internal-admin`)).rejects.toMatchObject({ cause: { code: 'ENOTPUBLIC' } })
        expect(internalHits).toEqual([])
    })
})
