import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckinDigest } from '@rerun/contracts'

const config = vi.hoisted(() => ({ hub: 'https://hub.test' as string | undefined }))
vi.mock('../config/env.js', () => ({ env: () => ({ RERUN_HUB_BASE_URL: config.hub, RERUN_API_KEY: 'engine-key', RERUN_LOG_LEVEL: 'fatal' }) }))

const { askTriage } = await import('./triage.js')

const digest: CheckinDigest = { workspaceAgeDays: 40, daysSinceLastCheckin: 3, daysSinceLastHumanMessage: 1, coworkers: 3, failedRuns24h: 0, failingCoworkers: [], pendingQuestions: 0, appsNeedingSignIn: 0, inactiveCoworkers: ['SEO watcher'], openSkillProposals: 2, neverUsed: ['company_brain'] }

afterEach(() => {
    vi.unstubAllGlobals()
    config.hub = 'https://hub.test'
})

describe('askTriage', () => {
    it('hands the digest to the hub and takes its answer', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ checkin: true, probability: 0.74 }), { status: 200 }))
        vi.stubGlobal('fetch', fetch)
        expect(await askTriage(digest)).toBe(true)
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://hub.test/api/foreman/triage')
        expect(JSON.parse(String(init.body))).toEqual({ digest })
    })

    it('reads any failure as no, so the rules decide alone', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
        expect(await askTriage(digest)).toBe(false)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ checkin: 'maybe' }), { status: 200 })))
        expect(await askTriage(digest)).toBe(false)
        config.hub = undefined
        expect(await askTriage(digest)).toBe(false)
    })
})
