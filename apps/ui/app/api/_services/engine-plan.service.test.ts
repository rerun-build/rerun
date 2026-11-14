import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setBoxPlan } from '@/lib/engine/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { assertModelEntitled, pushBoxPlan } from './engine-plan.service'
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ setBoxPlan: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceId: vi.fn(async () => 7) }))

const CONN = { baseUrl: 'http://engine', apiKey: null }

function workspace(subscription_status: string | null, is_sandbox = false) {
    vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { subscription_status, is_sandbox }, error: null } as never)
}

describe('engine plan', () => {
    beforeEach(() => vi.clearAllMocks())

    it('tells a trial box to step premium models down, and a paid one to run them', async () => {
        workspace('trialing')
        await pushBoxPlan(7, CONN)
        expect(setBoxPlan).toHaveBeenLastCalledWith(CONN, { premiumModels: false })

        workspace('active')
        await pushBoxPlan(7, CONN)
        expect(setBoxPlan).toHaveBeenLastCalledWith(CONN, { premiumModels: true })
    })

    it('never fails the caller when the box cannot be reached', async () => {
        workspace('active')
        vi.mocked(setBoxPlan).mockRejectedValueOnce(new Error('404'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(pushBoxPlan(7, CONN)).resolves.toBeUndefined()
    })

    it('refuses a premium pin on a trial and lets the rest through without reading the plan', async () => {
        workspace('trialing')
        await expect(assertModelEntitled('claude-opus-5-5')).rejects.toThrow('Opus 5.5 is available with a paid plan.')
        await expect(assertModelEntitled('gpt-6-astra', 7)).rejects.toThrow(/paid plan/)

        vi.mocked(selectMaybeSingle).mockClear()
        await expect(assertModelEntitled('gpt-6-sol')).resolves.toBeUndefined()
        await expect(assertModelEntitled(null)).resolves.toBeUndefined()
        expect(selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('lets a paid workspace pin anything', async () => {
        workspace('active')
        await expect(assertModelEntitled('claude-fable-5-1', 7)).resolves.toBeUndefined()
    })
})
