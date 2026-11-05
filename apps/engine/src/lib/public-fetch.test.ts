import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NonPublicHostError, assertPublicUrl, fetchPublic, isHttpUrl, resolvesToPublicAddresses } from './public-fetch.js'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

const RESOLVED: Record<string, string> = {
    'public.test': '93.184.216.34',
    'cdn.public.test': '93.184.216.35',
    'internal.test': '10.0.0.7',
    'metadata.test': '169.254.169.254',
}

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

describe('isHttpUrl', () => {
    it.each(['http://public.test/', 'https://public.test/x?y#z'])('accepts %s', url => {
        expect(isHttpUrl(url)).toBe(true)
    })

    it.each(['file:///etc/passwd', 'ftp://public.test/', 'javascript:alert(1)', 'data:text/html,hi', 'not a url'])('refuses %s', url => {
        expect(isHttpUrl(url)).toBe(false)
    })
})

describe('resolvesToPublicAddresses', () => {
    it.each(['127.0.0.1', '[::1]', '169.254.169.254', '100.64.0.1', '::ffff:10.0.0.1', '[::ffff:10.0.0.1]', 'internal.test', 'metadata.test', 'unknown.test'])('refuses %s', async host => {
        expect(await resolvesToPublicAddresses(host)).toBe(false)
    })

    it('accepts a name that resolves to a public address', async () => {
        expect(await resolvesToPublicAddresses('public.test')).toBe(true)
    })

    it('refuses a name with one private address among public ones', async () => {
        mocks.lookup.mockResolvedValueOnce([
            { address: '93.184.216.34', family: 4 },
            { address: '192.168.1.1', family: 4 },
        ])
        expect(await resolvesToPublicAddresses('mixed.test')).toBe(false)
    })
})

describe('assertPublicUrl', () => {
    it.each(['http://127.0.0.1:8080/mcp', 'http://[::ffff:10.0.0.1]/', 'https://metadata.test/latest', 'file:///etc/passwd', 'not a url'])('refuses %s with a typed error', async url => {
        await expect(assertPublicUrl(url)).rejects.toThrow(NonPublicHostError)
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

    it('passes the signal of the caller through instead of its own timeout', async () => {
        const fetchMock = stubFetch({ 'https://public.test/a': new Response('ok') })
        const controller = new AbortController()

        await fetchPublic('https://public.test/a', { signal: controller.signal })

        expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
    })
})
