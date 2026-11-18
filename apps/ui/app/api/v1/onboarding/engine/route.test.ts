import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimWelcomeEngineAction = vi.fn()
const welcomeEngineAnswersAction = vi.fn()
const finishWelcomeAction = vi.fn()

vi.mock('@/app/api/_actions/welcome-engine.actions', () => ({
    claimWelcomeEngineAction: () => claimWelcomeEngineAction(),
    welcomeEngineAnswersAction: () => welcomeEngineAnswersAction(),
    finishWelcomeAction: () => finishWelcomeAction(),
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireAdminContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, role: 'admin', supabase: {} }),
}))

const engine = await import('./route')
const finish = await import('../finish/route')

const segment = { params: Promise.resolve({}) }
const request = (path: string, method: 'GET' | 'POST') => new Request(`https://app.rerun.build/api/v1/onboarding/${path}`, { method })

describe('/api/v1/onboarding/engine', () => {
    beforeEach(() => {
        claimWelcomeEngineAction.mockReset().mockResolvedValue({ ok: true })
        welcomeEngineAnswersAction.mockReset().mockResolvedValue(false)
    })

    it('claims the machine', async () => {
        expect((await engine.POST(request('engine', 'POST'), segment)).status).toBe(204)
    })

    it('says why when there is no machine to claim', async () => {
        claimWelcomeEngineAction.mockResolvedValue({ ok: false, error: 'No machine is available.' })
        const res = await engine.POST(request('engine', 'POST'), segment)
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ error: 'No machine is available.' })
    })

    it('tells whether the machine answers yet', async () => {
        expect(await (await engine.GET(request('engine', 'GET'), segment)).json()).toEqual({ ready: false })
        welcomeEngineAnswersAction.mockResolvedValue(true)
        expect(await (await engine.GET(request('engine', 'GET'), segment)).json()).toEqual({ ready: true })
    })
})

describe('POST /api/v1/onboarding/finish', () => {
    it('closes the onboarding', async () => {
        finishWelcomeAction.mockResolvedValue({ ok: true })
        expect((await finish.POST(request('finish', 'POST'), segment)).status).toBe(204)
    })

    it('answers the failure when the stamp could not be written', async () => {
        finishWelcomeAction.mockResolvedValue({ ok: false, error: 'Could not save your answer.' })
        expect((await finish.POST(request('finish', 'POST'), segment)).status).toBe(503)
    })
})
