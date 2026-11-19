import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { triageCheckin } from '@/lib/foreman/checkin-triage'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))
vi.mock('@/lib/foreman/checkin-triage', () => ({ triageCheckin: vi.fn() }))

const { POST } = await import('./route')

const digest = { workspaceAgeDays: 21, daysSinceLastCheckin: 3, daysSinceLastHumanMessage: 1, coworkers: 4, failedRuns24h: 0, failingCoworkers: [], pendingQuestions: 0, appsNeedingSignIn: 0, inactiveCoworkers: ['Invoice chaser'], openSkillProposals: 2, neverUsed: ['company_brain'] }

let workspaceId = 100
const request = (body: unknown, token: string | null = 'engine-key') => new Request('https://rerun.test/api/foreman/triage', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
    vi.clearAllMocks()
    workspaceId++
    vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'engine-key' ? { workspaceId, isSandbox: false } : null))
    vi.mocked(triageCheckin).mockResolvedValue({ checkin: true, probability: 0.74 })
})

describe('POST /api/foreman/triage', () => {
    it('refuses a caller without the key of a box', async () => {
        expect((await POST(request({ digest }, null))).status).toBe(401)
        expect(triageCheckin).not.toHaveBeenCalled()
    })

    it('answers whether today is worth a check-in', async () => {
        const res = await POST(request({ digest }))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ checkin: true, probability: 0.74 })
        expect(triageCheckin).toHaveBeenCalledWith(digest)
    })

    it('takes only the digest it knows: no extra field, no text, nothing oversized', async () => {
        expect((await POST(request({ digest: { ...digest, transcript: 'the whole conversation' } }))).status).toBe(400)
        expect((await POST(request({ digest: { ...digest, inactiveCoworkers: ['x'.repeat(61)] } }))).status).toBe(400)
        expect((await POST(request({ digest, extra: true }))).status).toBe(400)
        expect((await POST(request('{not json'))).status).toBe(400)
        expect((await POST(request(JSON.stringify({ digest, pad: 'x'.repeat(9000) })))).status).toBe(413)
        expect(triageCheckin).not.toHaveBeenCalled()
    })

    it('answers a few calls a day per workspace at most', async () => {
        for (let i = 0; i < 4; i++) expect((await POST(request({ digest }))).status).toBe(200)
        expect((await POST(request({ digest }))).status).toBe(429)
    })

    it('says it is unavailable when the model is not there, so the box decides alone', async () => {
        vi.mocked(triageCheckin).mockResolvedValue(null)
        expect((await POST(request({ digest }))).status).toBe(503)
    })
})
