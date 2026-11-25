import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    selectMaybeSingle: vi.fn(),
    selectAll: vi.fn(),
    rows: {} as Record<string, unknown>,
}))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectSingle: vi.fn(), selectMaybeSingle: mocks.selectMaybeSingle, selectAll: mocks.selectAll }))

const { AuthorizationError } = await import('./ownership')
const { assertTemplateOwnedBy, hasPendingCreatorTerms, isExpertAccount, requireExpertUserId, requireSandboxAuthorKey, requireSandboxAuthorSession } = await import('./expert')

beforeEach(() => {
    mocks.rows = {
        users: { account_role: 'expert', expert_profile_id: 'x1' },
        workspaces: { is_sandbox: true },
        experts: { creator_joined_at: '2026-09-01', creator_terms_accepted_at: '2026-09-02' },
        templates: { id: 't1', slug: 'slug', status: 'draft' },
    }
    mocks.getServerSession.mockReset().mockResolvedValue({ user: { id: 'u1', workspace_id: 1 }, workspaceRefused: false })
    mocks.selectMaybeSingle.mockReset().mockImplementation(async (_client, table: string) => ({ data: mocks.rows[table] ?? null, error: null }))
    mocks.selectAll.mockReset().mockResolvedValue({ data: [{ user_id: 'founder' }], error: null })
})

describe('isExpertAccount', () => {
    it('answers true for an expert account', async () => {
        await expect(isExpertAccount('u1')).resolves.toBe(true)
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ id: 'u1' })
    })

    it('answers false for any other role', async () => {
        mocks.rows.users = { account_role: 'user' }
        await expect(isExpertAccount('u1')).resolves.toBe(false)
    })

    it('answers false for an unknown user', async () => {
        mocks.rows.users = null
        await expect(isExpertAccount('u1')).resolves.toBe(false)
    })
})

describe('hasPendingCreatorTerms', () => {
    it('answers false for an account that is not an expert', async () => {
        mocks.rows.users = { account_role: 'user', expert_profile_id: 'x1' }
        await expect(hasPendingCreatorTerms('u1')).resolves.toBe(false)
    })

    it('answers false for an expert with no expert profile', async () => {
        mocks.rows.users = { account_role: 'expert', expert_profile_id: null }
        await expect(hasPendingCreatorTerms('u1')).resolves.toBe(false)
    })

    it('answers false for an expert flagged by hand who never joined the creator program', async () => {
        mocks.rows.experts = { creator_joined_at: null, creator_terms_accepted_at: null }
        await expect(hasPendingCreatorTerms('u1')).resolves.toBe(false)
    })

    it('answers true for a creator who joined but has not accepted the terms', async () => {
        mocks.rows.experts = { creator_joined_at: '2026-09-01', creator_terms_accepted_at: null }
        await expect(hasPendingCreatorTerms('u1')).resolves.toBe(true)
    })

    it('answers false once the terms are accepted', async () => {
        await expect(hasPendingCreatorTerms('u1')).resolves.toBe(false)
    })
})

describe('requireExpertUserId', () => {
    it('answers the id of a signed-in expert', async () => {
        await expect(requireExpertUserId()).resolves.toBe('u1')
    })

    it('refuses a caller without a session', async () => {
        mocks.getServerSession.mockResolvedValue({ user: null })
        await expect(requireExpertUserId()).rejects.toThrow('Not authenticated')
    })

    it('refuses a signed-in user who is not an expert', async () => {
        mocks.rows.users = { account_role: 'user' }
        await expect(requireExpertUserId()).rejects.toThrow('Reserved for expert accounts')
    })
})

describe('requireSandboxAuthorSession', () => {
    it('answers the expert and their sandbox workspace', async () => {
        await expect(requireSandboxAuthorSession()).resolves.toEqual({ userId: 'u1', workspaceId: 1 })
        const workspaceRead = mocks.selectMaybeSingle.mock.calls.find(call => call[1] === 'workspaces')
        expect(workspaceRead?.[3]).toEqual({ id: 1 })
    })

    it('refuses an expert looking at a real workspace', async () => {
        mocks.rows.workspaces = { is_sandbox: false }
        await expect(requireSandboxAuthorSession()).rejects.toThrow('Coworkers can only be captured from your sandbox')
    })

    it('refuses a workspace that does not exist', async () => {
        mocks.rows.workspaces = null
        await expect(requireSandboxAuthorSession()).rejects.toBeInstanceOf(AuthorizationError)
    })
})

describe('requireSandboxAuthorKey', () => {
    it('answers the founder of a sandbox workspace when they are an expert', async () => {
        await expect(requireSandboxAuthorKey(1)).resolves.toEqual({ userId: 'founder', workspaceId: 1 })
        const userRead = mocks.selectMaybeSingle.mock.calls.find(call => call[1] === 'users')
        expect(userRead?.[3]).toEqual({ id: 'founder' })
    })

    it('refuses a key issued on a workspace that is not a sandbox', async () => {
        mocks.rows.workspaces = { is_sandbox: false }
        await expect(requireSandboxAuthorKey(1)).rejects.toThrow(/sandbox workspace/)
        expect(mocks.selectAll).not.toHaveBeenCalled()
    })

    it('refuses a sandbox with no member', async () => {
        mocks.selectAll.mockResolvedValue({ data: [], error: null })
        await expect(requireSandboxAuthorKey(1)).rejects.toThrow(/no member/)
    })

    it('refuses a sandbox whose founder is not an expert', async () => {
        mocks.rows.users = { account_role: 'user' }
        await expect(requireSandboxAuthorKey(1)).rejects.toThrow(/reserved for expert accounts/)
    })
})

describe('assertTemplateOwnedBy', () => {
    it('reads the template scoped by its creator', async () => {
        await expect(assertTemplateOwnedBy('u1', 't1')).resolves.toEqual({ id: 't1', slug: 'slug', status: 'draft' })
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ id: 't1', creator_id: 'u1' })
    })

    it('refuses a template of another creator the same way as a missing one', async () => {
        mocks.rows.templates = null
        await expect(assertTemplateOwnedBy('u1', 't1')).rejects.toThrow('Template not found')
    })
})
