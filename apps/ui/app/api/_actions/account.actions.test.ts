import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn(), anonymizeAccount: vi.fn(), accountDeletionBlockers: vi.fn() }))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/app/api/_services/account-deletion.service', () => ({ anonymizeAccount: mocks.anonymizeAccount, accountDeletionBlockers: mocks.accountDeletionBlockers }))

const { deleteMyAccountAction, getAccountDeletionStatusAction } = await import('./account.actions')

const ACCOUNT = { id: 'user-1', email: 'ada@rerun.build' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ session: ACCOUNT, isAnonymous: false })
    mocks.anonymizeAccount.mockResolvedValue({ ok: true })
    mocks.accountDeletionBlockers.mockResolvedValue([])
})

describe('deleteMyAccountAction', () => {
    it('refuses an anonymous visitor', async () => {
        mocks.getServerSession.mockResolvedValue({ session: { id: 'anon' }, isAnonymous: true })

        await expect(deleteMyAccountAction({ confirmation: 'DELETE' })).resolves.toMatchObject({ ok: false })
        expect(mocks.anonymizeAccount).not.toHaveBeenCalled()
    })

    it('deletes nothing without the typed confirmation', async () => {
        await expect(deleteMyAccountAction({ confirmation: 'delete' })).resolves.toEqual({ ok: false, error: 'Type DELETE to confirm.', code: 'typeToConfirm', params: { word: 'DELETE' } })
        expect(mocks.anonymizeAccount).not.toHaveBeenCalled()
    })

    it('anonymizes the signed-in account', async () => {
        await expect(deleteMyAccountAction({ confirmation: ' DELETE ' })).resolves.toEqual({ ok: true })
        expect(mocks.anonymizeAccount).toHaveBeenCalledWith(expect.anything(), ACCOUNT.id)
    })

    it('names the workspaces whose plan has to be cancelled first', async () => {
        mocks.anonymizeAccount.mockResolvedValue({ ok: false, blockers: [{ workspaceId: 2, name: 'Side project' }] })

        await expect(deleteMyAccountAction({ confirmation: 'DELETE' })).resolves.toEqual({ ok: false, error: 'Cancel the subscription of Side project first.', code: 'cancelSubscriptionsFirst', params: { names: 'Side project' } })
    })
})

describe('getAccountDeletionStatusAction', () => {
    it('answers the blockers of the signed-in account', async () => {
        mocks.accountDeletionBlockers.mockResolvedValue([{ workspaceId: 2, name: 'Side project' }])

        await expect(getAccountDeletionStatusAction()).resolves.toEqual({ ok: true, blockers: [{ workspaceId: 2, name: 'Side project' }] })
        expect(mocks.accountDeletionBlockers).toHaveBeenCalledWith(expect.anything(), ACCOUNT.id)
    })
})
