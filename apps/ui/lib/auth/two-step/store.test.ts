import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle }))

const { readTwoStep } = await import('./store')

const recovery = { factorId: 'recovery', sealedSecret: 'sealed' }

describe('readTwoStep', () => {
    beforeEach(() => mocks.selectMaybeSingle.mockReset())

    it('hands back what the account keeps', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { two_step: { recovery } }, error: null })
        expect(await readTwoStep('user-1')).toEqual({ recovery })
    })

    it('is empty for an account that never set two-step up', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { two_step: null }, error: null })
        expect(await readTwoStep('user-1')).toEqual({})
    })

    it('throws on a read that failed, rather than pass for an account without methods', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'upstream timed out' } })
        await expect(readTwoStep('user-1')).rejects.toThrow('upstream timed out')
    })
})
