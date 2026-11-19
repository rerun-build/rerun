import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-hub-'))
process.env.RERUN_HUB_BASE_URL = 'https://hub.test/'
process.env.RERUN_API_KEY = 'engine-token'

const { afterEach, describe, expect, it, vi } = await import('vitest')
const { callHub } = await import('./hub.js')
const { FOREMAN_HUB_TOKEN_HEADER } = await import('@moldwright/contracts')

const originalFetch = globalThis.fetch

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl)
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
}

afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
})

describe('callHub', () => {
    it('posts the tool call to the hub as the calling agent and returns its JSON', async () => {
        const fetchMock = mockFetch(async () => Response.json({ services: ['stripe'] }))

        const result = await callHub({ id: 'agent-1' }, 'search_services', { query: 'pay' })

        expect(result).toEqual({ services: ['stripe'] })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://hub.test/api/hub')
        expect(init.method).toBe('POST')
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer engine-token', 'x-rerun-agent': 'agent-1' })
        expect(JSON.parse(init.body as string)).toEqual({ tool: 'search_services', args: { query: 'pay' } })
    })

    it('hands back the token of the foreman brief, and none for a caller without one', async () => {
        const fetchMock = mockFetch(async () => Response.json({}))

        await callHub({ id: 'foreman', brief: { instructions: 'x', tools: [], hubToken: 'signed-by-hub' } }, 'list_agents', {})
        await callHub({ id: 'foreman', brief: { instructions: 'x', tools: [] } }, 'list_agents', {})

        expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer engine-token', 'x-rerun-agent': 'foreman', [FOREMAN_HUB_TOKEN_HEADER]: 'signed-by-hub' })
        expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty(FOREMAN_HUB_TOKEN_HEADER)
    })

    it('includes the response body in the error of a failed call', async () => {
        mockFetch(async () => new Response('tool not allowed', { status: 403 }))

        await expect(callHub({ id: 'a' }, 't', {})).rejects.toThrow('Hub call failed (403): tool not allowed')
    })

    it('reports only the status when the failed call has no body', async () => {
        mockFetch(async () => new Response('', { status: 500 }))

        await expect(callHub({ id: 'a' }, 't', {})).rejects.toThrow(/^Hub call failed \(500\)$/)
    })

    it('reports only the status when the error body cannot be read', async () => {
        mockFetch(async () => ({ ok: false, status: 502, text: async () => Promise.reject(new Error('stream broke')) }) as unknown as Response)

        await expect(callHub({ id: 'a' }, 't', {})).rejects.toThrow(/^Hub call failed \(502\)$/)
    })

    it('aborts a call that outlives its timeout', async () => {
        vi.useFakeTimers()
        mockFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
                }),
        )

        const pending = callHub({ id: 'a' }, 't', {}, 1000)
        const assertion = expect(pending).rejects.toThrow('aborted')
        await vi.advanceTimersByTimeAsync(1000)
        await assertion
    })

    it('waits 20 seconds by default before aborting', async () => {
        vi.useFakeTimers()
        let aborted = false
        mockFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => {
                        aborted = true
                        reject(new Error('aborted'))
                    })
                }),
        )

        const pending = callHub({ id: 'a' }, 't', {})
        const assertion = expect(pending).rejects.toThrow('aborted')
        await vi.advanceTimersByTimeAsync(19_999)
        expect(aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await assertion
    })
})
