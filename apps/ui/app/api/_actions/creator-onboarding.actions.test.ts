import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn(), enterSandbox: vi.fn(), captureServer: vi.fn() }))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/sandbox.service', () => ({ enterSandbox: mocks.enterSandbox }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: mocks.captureServer, deterministicUuid: (seed: string) => seed }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { claimCreatorSandboxAction } = await import('./creator-onboarding.actions')

type Row = Record<string, unknown>

const ME = 'user-me'

function tableResolver(rows: Record<string, Row[]>) {
    return (table: string, calls: readonly SupabaseCall[]) => {
        if (writeMethodOf(calls)) return undefined
        const matching = (rows[table] ?? []).filter(row => calls.every(call => call.method !== 'eq' || row[call.args[0] as string] === call.args[1]))
        return { data: matching[0] ?? null }
    }
}

function database(rows: Record<string, Row[]>): FakeSupabase {
    const db = fakeSupabase(tableResolver(rows))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

function expert(overrides: Row = {}): Row {
    return { id: 'expert-1', slug: 'jane', email: 'jane@studio.test', status: 'accepted', application_status: 'approved', creator_token: 'tok', ...overrides }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: ME }, session: { email: 'jane@studio.test' }, isAnonymous: false })
    mocks.enterSandbox.mockResolvedValue({ ok: true, workspaceId: 50 })
})

describe('claimCreatorSandboxAction', () => {
    it('refuses a creator profile already linked to another account', async () => {
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }, { id: 'user-other', expert_profile_id: 'expert-1' }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This creator profile is already linked to another account.', code: 'creatorProfileTaken' })
        expect(db.writes('users')).toHaveLength(0)
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })

    it('refuses an account already linked to a different creator profile', async () => {
        const db = database({ experts: [expert(), expert({ id: 'expert-2', creator_token: 'other' })], users: [{ id: ME, expert_profile_id: 'expert-2' }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This account is already linked to another creator profile.', code: 'accountHasOtherCreatorProfile' })
        expect(db.writes('users')).toHaveLength(0)
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })

    it('refuses an invitation that was declined', async () => {
        database({ experts: [expert({ status: 'declined' })], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This creator invitation is not open anymore.', code: 'creatorInviteClosed' })
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })

    it('refuses an invitation whose application was rejected', async () => {
        database({ experts: [expert({ application_status: 'rejected' })], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This creator invitation is not open anymore.', code: 'creatorInviteClosed' })
    })

    it('refuses an unknown token', async () => {
        database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('forged')).resolves.toEqual({ ok: false, error: 'This link is no longer valid.', code: 'linkInvalid' })
    })

    it('refuses an account without a profile when no token is given', async () => {
        database({ users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction()).resolves.toEqual({ ok: false, error: 'This account is not linked to a creator profile.', code: 'noCreatorProfile' })
    })

    it('links the profile to the caller, flags the account expert and opens the sandbox', async () => {
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: true, workspaceId: 50 })

        expect(db.writes('users')).toEqual([{ method: 'update', payload: { account_role: 'expert', expert_profile_id: 'expert-1' }, filters: [{ table: 'users', method: 'eq', args: ['id', ME] }] }])
        expect(db.writes('experts')[0].payload).toEqual({ creator_joined_at: expect.any(String), updated_at: expect.any(String) })
        expect(mocks.enterSandbox).toHaveBeenCalledWith(ME)
    })

    it('reopens the sandbox without relinking a profile the caller already holds', async () => {
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: 'expert-1' }] })

        await expect(claimCreatorSandboxAction()).resolves.toEqual({ ok: true, workspaceId: 50 })
        expect(db.writes('users')).toHaveLength(0)
        expect(mocks.captureServer).not.toHaveBeenCalled()
    })

    it('refuses a forwarded link opened by an account with another email', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME }, session: { email: 'someone@else.test' }, isAnonymous: false })
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This invitation is for another email. Sign in with the invited address.', code: 'invitationOtherEmail' })
        expect(db.writes('users')).toHaveLength(0)
        expect(db.writes('experts')).toHaveLength(0)
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })

    it('refuses to link a profile that has no email on file', async () => {
        const db = database({ experts: [expert({ email: null })], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'This invitation is for another email. Sign in with the invited address.', code: 'invitationOtherEmail' })
        expect(db.writes('users')).toHaveLength(0)
    })

    it('matches the invited email whatever its case', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME }, session: { email: 'Jane@Studio.TEST' }, isAnonymous: false })
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: true, workspaceId: 50 })
        expect(db.writes('users')).toHaveLength(1)
    })

    it('refuses an anonymous session without reading the invitation', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME }, session: { email: 'jane@studio.test', is_anonymous: true }, isAnonymous: true })
        const db = database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'Sign in with the invited email to claim your creator profile.', code: 'signInToClaimCreator' })
        expect(db.calls).toHaveLength(0)
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })

    it('refuses a session without an email', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: ME }, session: { email: undefined }, isAnonymous: false })
        database({ experts: [expert()], users: [{ id: ME, expert_profile_id: null }] })

        await expect(claimCreatorSandboxAction('tok')).resolves.toEqual({ ok: false, error: 'Sign in with the invited email to claim your creator profile.', code: 'signInToClaimCreator' })
        expect(mocks.enterSandbox).not.toHaveBeenCalled()
    })
})
