import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ hub: 'https://hub.test/' as string | undefined, key: 'engine-key' as string | undefined }))

vi.mock('../config/env.js', () => ({ env: () => ({ RERUN_HUB_BASE_URL: config.hub, RERUN_API_KEY: config.key, RERUN_LOG_LEVEL: 'fatal' }) }))

const { CHECKIN_FALLBACK_INSTRUCTIONS, fetchCheckinBrief } = await import('./brief.js')

const brief = { instructions: 'The charter of a check-in.', tools: [{ name: 'list_agents', description: 'List.', inputSchema: { type: 'object' }, kind: 'hub' }], hubToken: 'read-token' }

afterEach(() => {
    vi.unstubAllGlobals()
    config.hub = 'https://hub.test/'
    config.key = 'engine-key'
})

describe('fetchCheckinBrief', () => {
    it('asks the hub with the engine key and takes the brief it hands back', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify(brief), { status: 200 }))
        vi.stubGlobal('fetch', fetch)
        expect(await fetchCheckinBrief('pulse')).toEqual({ ...brief, tools: [{ ...brief.tools[0], serial: false }] })
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://hub.test/api/foreman/checkin-brief')
        expect(init.headers).toMatchObject({ Authorization: 'Bearer engine-key' })
        expect(JSON.parse(String(init.body))).toEqual({ reason: 'pulse' })
    })

    it('runs on its own charter when the hub has no such route, answers nonsense or is not there', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
        expect(await fetchCheckinBrief('manual')).toEqual({ instructions: CHECKIN_FALLBACK_INSTRUCTIONS, tools: [] })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tools: 'all of them' }), { status: 200 })))
        expect((await fetchCheckinBrief('manual')).tools).toEqual([])
        vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
        expect((await fetchCheckinBrief('manual')).instructions).toBe(CHECKIN_FALLBACK_INSTRUCTIONS)
    })

    it('never calls out from an engine linked to no hub', async () => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)
        config.hub = undefined
        expect((await fetchCheckinBrief('pulse')).instructions).toBe(CHECKIN_FALLBACK_INSTRUCTIONS)
        expect(fetch).not.toHaveBeenCalled()
    })
})
