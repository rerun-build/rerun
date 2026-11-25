import { beforeEach, describe, expect, it, vi } from 'vitest'

const readWelcomeState = vi.fn()
const resolveEngineWaitlist = vi.fn()
const workspace = { id: 7 }

vi.mock('@/lib/onboarding/welcome.server', () => ({ readWelcomeState: (...args: unknown[]) => readWelcomeState(...args) }))
vi.mock('@/app/api/_services/waitlist.service', () => ({ resolveEngineWaitlist: (...args: unknown[]) => resolveEngineWaitlist(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'admin', supabase: {} }),
}))

const { GET } = await import('./route')

const read = async () => (await GET(new Request('https://app.rerun.build/api/v1/onboarding'), { params: Promise.resolve({}) })).json()

describe('GET /api/v1/onboarding', () => {
    beforeEach(() => {
        readWelcomeState.mockReset()
        resolveEngineWaitlist.mockReset().mockResolvedValue(false)
    })

    it.each(['industry'])('stays on the questions while "%s" is unanswered', async step => {
        readWelcomeState.mockResolvedValue({ needed: true, step, answers: {}, firstName: 'Ada' })
        expect(await read()).toEqual({ needed: true, stage: 'questions', waitlisted: false, firstName: 'Ada' })
    })

    it.each(['team', 'trial', 'engine'])('moves to the setup at "%s": the app invites nobody', async step => {
        readWelcomeState.mockResolvedValue({ needed: true, step, answers: {}, firstName: null })
        expect(await read()).toEqual({ needed: true, stage: 'setup', waitlisted: false, firstName: '' })
    })

    it('says when no machine is left to start on', async () => {
        readWelcomeState.mockResolvedValue({ needed: true, step: 'trial', answers: {}, firstName: null })
        resolveEngineWaitlist.mockResolvedValue(true)
        expect((await read()).waitlisted).toBe(true)
    })

    it('never asks the pool for a workspace past its onboarding', async () => {
        readWelcomeState.mockResolvedValue({ needed: false, step: 'engine', answers: {}, firstName: 'Ada' })
        expect(await read()).toEqual({ needed: false, stage: 'setup', waitlisted: false, firstName: 'Ada' })
        expect(resolveEngineWaitlist).not.toHaveBeenCalled()
    })
})
