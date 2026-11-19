import { beforeEach, describe, expect, it, vi } from 'vitest'

const startCardlessTrial = vi.fn()
const mergeForeman = vi.fn()
const workspace = { id: 7, subscription_status: null as string | null }
const billing = vi.hoisted(() => ({ enabled: true }))

vi.mock('@rerun/cloud/billing', async () => ({
    ...(await vi.importActual<typeof import('@/ee/lib/billing/entitlement')>('@/ee/lib/billing/entitlement')),
    ...(await vi.importActual<typeof import('@/ee/lib/billing/plans')>('@/ee/lib/billing/plans')),
    get BILLING_ENABLED() {
        return billing.enabled
    },
}))
vi.mock('@/ee/services/billing.service', () => ({
    ENGINE_WAITLIST_MESSAGE: 'Every machine is taken right now.',
    startCardlessTrial: (...args: unknown[]) => startCardlessTrial(...args),
}))
vi.mock('@/lib/foreman/profile', () => ({ mergeForeman: (...args: unknown[]) => mergeForeman(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'admin', supabase: {} }),
    requireAdminContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'admin', supabase: {} }),
}))

const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = (client?: string) => new Request('https://app.rerun.build/api/v1/onboarding/trial', { method: 'POST', headers: client ? { 'x-rerun-client': client } : {} })

describe('POST /api/v1/onboarding/trial', () => {
    beforeEach(() => {
        workspace.subscription_status = null
        billing.enabled = true
        startCardlessTrial.mockReset().mockResolvedValue(true)
        mergeForeman.mockReset().mockResolvedValue({})
    })

    it('starts the trial as the app, and marks it so the trial test leaves it out', async () => {
        expect(await (await POST(request(), segment)).json()).toEqual({ entitled: true })
        expect(startCardlessTrial).toHaveBeenCalledWith('ios')
        expect(mergeForeman).toHaveBeenCalledWith(expect.anything(), { trialStartedIn: 'ios' })
    })

    it.each([
        ['ios/1.4.0 (41)', 'ios'],
        ['android/1.0.0 (3)', 'android'],
    ])('starts it as the platform of %s', async (client, platform) => {
        expect(await (await POST(request(client), segment)).json()).toEqual({ entitled: true })
        expect(startCardlessTrial).toHaveBeenCalledWith(platform)
        expect(mergeForeman).toHaveBeenCalledWith(expect.anything(), { trialStartedIn: platform })
    })

    it('marks nothing for a workspace that was already on', async () => {
        workspace.subscription_status = 'trialing'
        expect(await (await POST(request(), segment)).json()).toEqual({ entitled: true })
        expect(mergeForeman).not.toHaveBeenCalled()
    })

    it('answers false for a spent trial, which only the web can take further', async () => {
        startCardlessTrial.mockResolvedValue(false)
        expect(await (await POST(request(), segment)).json()).toEqual({ entitled: false })
        expect(mergeForeman).not.toHaveBeenCalled()
    })

    it('answers that the workspace is on where nothing is sold, without asking for a trial', async () => {
        billing.enabled = false
        expect(await (await POST(request(), segment)).json()).toEqual({ entitled: true })
        expect(startCardlessTrial).not.toHaveBeenCalled()
        expect(mergeForeman).not.toHaveBeenCalled()
    })

    it('says why when every machine is taken', async () => {
        startCardlessTrial.mockRejectedValue(new Error('Every machine is taken right now.'))
        const res = await POST(request(), segment)
        expect(res.status).toBe(409)
        expect(await res.json()).toEqual({ error: 'Every machine is taken right now.', code: 'engineWaitlist' })
    })
})
