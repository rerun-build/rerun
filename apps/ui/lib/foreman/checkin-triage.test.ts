import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckinDigest } from '@rerun/contracts'

vi.mock('server-only', () => ({}))

const { TRIAGE_THRESHOLD, triageCheckin } = await import('./checkin-triage')

const digest: CheckinDigest = { workspaceAgeDays: 21, daysSinceLastCheckin: 3, daysSinceLastHumanMessage: 1, coworkers: 4, failedRuns24h: 0, failingCoworkers: [], pendingQuestions: 0, appsNeedingSignIn: 0, inactiveCoworkers: ['Invoice chaser'], openSkillProposals: 2, neverUsed: ['webhook_triggers', 'company_brain'] }

const answer = (write: unknown) => new Response(JSON.stringify({ answers: { checkin: { type: 'choice', choice: 'write', probabilities: { write, wait: 0.2 } } } }), { status: 200 })

beforeEach(() => vi.stubEnv('OPENROUTER_API_KEY', 'or-key'))
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('triageCheckin', () => {
    it('asks the decision model about the digest, in plain words, and says yes past the threshold', async () => {
        const fetch = vi.fn(async () => answer(0.74))
        vi.stubGlobal('fetch', fetch)
        expect(await triageCheckin(digest)).toEqual({ checkin: true, probability: 0.74 })
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
        const body = JSON.parse(String(init.body))
        expect(body.model).toBe('typesafe/jev-1.14')
        expect(body.state).toMatchObject({ inactive_coworkers: ['Invoice chaser'], never_used: ['webhook triggers', 'company brain'] })
        expect(Object.keys(body.questions.checkin.criteria)).toEqual(['write', 'wait'])
    })

    it('says no under the threshold', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer(TRIAGE_THRESHOLD - 0.01)))
        expect((await triageCheckin(digest))?.checkin).toBe(false)
    })

    it('has nothing to say without a key, on a refusal or on an answer it cannot read', async () => {
        const fetch = vi.fn(async () => answer('high'))
        vi.stubGlobal('fetch', fetch)
        expect(await triageCheckin(digest)).toBeNull()
        fetch.mockResolvedValueOnce(new Response('busy', { status: 429 }))
        expect(await triageCheckin(digest)).toBeNull()
        vi.stubEnv('OPENROUTER_API_KEY', '')
        expect(await triageCheckin(digest)).toBeNull()
    })
})
