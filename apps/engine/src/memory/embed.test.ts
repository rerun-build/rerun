import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-embed-'))
process.env.RERUN_API_KEY = 'engine-secret'
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.test/'

const { afterEach, describe, expect, it, vi } = await import('vitest')
const { embedBaseUrl, embedText } = await import('./embed.js')

const realFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = realFetch
    vi.useRealTimers()
})

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl)
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

describe('embedBaseUrl', () => {
    it('strips the trailing slash of the hub url', () => {
        expect(embedBaseUrl()).toBe('https://hub.example.test')
    })
})

describe('embedText', () => {
    it('posts the text to the hub with the engine key and returns the embedding', async () => {
        const fetchMock = mockFetch(async () => Response.json({ embedding: [0.1, 0.2, 0.3] }))
        expect(await embedText('hello world')).toEqual([0.1, 0.2, 0.3])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://hub.example.test/api/embed')
        expect(init.method).toBe('POST')
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer engine-secret' })
        expect(JSON.parse(String(init.body))).toEqual({ text: 'hello world' })
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('returns null on a non-OK response', async () => {
        mockFetch(async () => new Response('nope', { status: 503 }))
        expect(await embedText('x')).toBeNull()
    })

    it.each([{ embedding: null }, { embedding: 'not an array' }, {}, { vector: [1, 2] }])('returns null when the body is %j', async body => {
        mockFetch(async () => Response.json(body))
        expect(await embedText('x')).toBeNull()
    })

    it('returns null when the body is not JSON', async () => {
        mockFetch(async () => new Response('<html>', { status: 200 }))
        expect(await embedText('x')).toBeNull()
    })

    it('returns null when fetch throws', async () => {
        mockFetch(async () => {
            throw new TypeError('fetch failed')
        })
        expect(await embedText('x')).toBeNull()
    })

    it('aborts and returns null after 5 seconds', async () => {
        vi.useFakeTimers()
        let aborted = false
        mockFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => {
                        aborted = true
                        reject(new DOMException('aborted', 'AbortError'))
                    })
                })
        )
        const pending = embedText('slow')
        await vi.advanceTimersByTimeAsync(4999)
        expect(aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(aborted).toBe(true)
        expect(await pending).toBeNull()
    })

    it('gives up sooner when the caller cannot wait that long', async () => {
        vi.useFakeTimers()
        let aborted = false
        mockFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => {
                        aborted = true
                        reject(new DOMException('aborted', 'AbortError'))
                    })
                })
        )
        const pending = embedText('slow', { timeoutMs: 1000 })
        await vi.advanceTimersByTimeAsync(999)
        expect(aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(aborted).toBe(true)
        expect(await pending).toBeNull()
    })

    it('clears its timer once the request settles', async () => {
        vi.useFakeTimers()
        mockFetch(async () => Response.json({ embedding: [1] }))
        await embedText('fast')
        expect(vi.getTimerCount()).toBe(0)
    })
})
