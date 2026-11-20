import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchKeenable } from './keenable'

const originalKey = process.env.KEENABLE_API_KEY
const originalFetch = globalThis.fetch

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

describe('searchKeenable', () => {
    beforeEach(() => {
        delete process.env.KEENABLE_API_KEY
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
        if (originalKey === undefined) delete process.env.KEENABLE_API_KEY
        else process.env.KEENABLE_API_KEY = originalKey
    })

    it('posts to the public endpoint with no key, and maps the results', async () => {
        const fetchMock = mockFetch(() =>
            Response.json({
                query: 'a & b',
                mode: 'pro',
                results: [
                    { title: 'One', url: 'https://one.test', description: '', snippet: 'first\n  line\twith   gaps ' },
                    { title: null, url: 'https://two.test', snippet: null },
                    { title: 'No link', url: '', snippet: 'dropped' },
                ],
            }),
        )

        await expect(searchKeenable('a & b', 2)).resolves.toEqual({
            status: 200,
            ok: true,
            results: [
                { title: 'One', url: 'https://one.test', snippet: 'first line with gaps' },
                { title: '', url: 'https://two.test', snippet: '' },
            ],
        })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.keenable.ai/v1/search/public')
        expect(init.method).toBe('POST')
        const headers = init.headers as Record<string, string>
        expect(headers['X-Keenable-Title']).toBe('Rerun')
        expect(headers['X-API-Key']).toBeUndefined()
        expect(JSON.parse(init.body as string)).toEqual({ query: 'a & b', max_results: 2, snippet_max_length: 400 })
    })

    it('uses the keyed endpoint when a key is set', async () => {
        process.env.KEENABLE_API_KEY = 'keen-key'
        const fetchMock = mockFetch(() => Response.json({ results: [] }))

        await searchKeenable('rerun', 5)

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.keenable.ai/v1/search')
        expect((init.headers as Record<string, string>)['X-API-Key']).toBe('keen-key')
    })

    it('answers an empty list when nothing was found', async () => {
        mockFetch(() => Response.json({ results: [] }))

        await expect(searchKeenable('nothing', 5)).resolves.toEqual({ status: 200, ok: true, results: [] })
    })

    it('reports the status Keenable refused with', async () => {
        mockFetch(() => Response.json({ error: 'Rate limited' }, { status: 429 }))

        await expect(searchKeenable('rerun', 5)).resolves.toEqual({ status: 429, ok: false, results: [] })
    })

    it('reports no status when Keenable cannot be reached', async () => {
        mockFetch(() => {
            throw new Error('ECONNRESET')
        })

        await expect(searchKeenable('rerun', 5)).resolves.toEqual({ status: null, ok: false, results: [] })
    })
})
