import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchKeirolabs } from './keirolabs'

const originalKey = process.env.KEIROLABS_API_KEY
const originalFetch = globalThis.fetch

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init))
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

describe('searchKeirolabs', () => {
    beforeEach(() => {
        process.env.KEIROLABS_API_KEY = 'keiro-key'
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
        if (originalKey === undefined) delete process.env.KEIROLABS_API_KEY
        else process.env.KEIROLABS_API_KEY = originalKey
    })

    it('returns null without a key, and calls nothing', async () => {
        delete process.env.KEIROLABS_API_KEY
        const fetchMock = mockFetch(() => Response.json({}))

        await expect(searchKeirolabs('rerun', 5)).resolves.toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('posts the query to the lite endpoint with the key as a bearer token, and maps the results', async () => {
        const fetchMock = mockFetch(() =>
            Response.json({
                results: [
                    { position: 1, title: 'One', url: 'https://one.test', snippet: 'first', domain: 'one.test', score: null },
                    { position: 2, title: null, url: 'https://two.test', snippet: null },
                    { position: 3, title: 'No link', url: '', snippet: 'dropped' },
                ],
                count: 3,
                creditsCharged: 0.0375,
            }),
        )

        await expect(searchKeirolabs('a & b', 2)).resolves.toEqual({
            status: 200,
            ok: true,
            results: [
                { title: 'One', url: 'https://one.test', snippet: 'first' },
                { title: '', url: 'https://two.test', snippet: '' },
            ],
        })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.keirolabs.cloud/api/v2/search/lite')
        expect(init.method).toBe('POST')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer keiro-key')
        expect(JSON.parse(init.body as string)).toEqual({ query: 'a & b', maxResults: 2 })
    })

    it('answers an empty list when Keirolabs found nothing', async () => {
        mockFetch(() => Response.json({ results: [], count: 0 }))

        await expect(searchKeirolabs('nothing', 5)).resolves.toEqual({ status: 200, ok: true, results: [] })
    })

    it('reports the status Keirolabs refused with', async () => {
        mockFetch(() => Response.json({ error: 'Invalid API key' }, { status: 401 }))

        await expect(searchKeirolabs('rerun', 5)).resolves.toEqual({ status: 401, ok: false, results: [] })
    })

    it('reports no status when Keirolabs cannot be reached', async () => {
        mockFetch(() => {
            throw new Error('ECONNRESET')
        })

        await expect(searchKeirolabs('rerun', 5)).resolves.toEqual({ status: null, ok: false, results: [] })
    })
})
