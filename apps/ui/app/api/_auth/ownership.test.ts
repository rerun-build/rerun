import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    selectSingle: vi.fn(),
    selectMaybeSingle: vi.fn(),
    selectMany: vi.fn(),
    client: {},
}))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectSingle: mocks.selectSingle, selectMaybeSingle: mocks.selectMaybeSingle, selectMany: mocks.selectMany }))

const {
    AuthorizationError,
    UnauthenticatedError,
    assertSpaceInWorkspace,
    assertSpaceOwnedBy,
    requireAdminContext,
    requireWorkspaceContext,
    requireWorkspaceId,
    workspaceFounderUserId,
} = await import('./ownership')

function sessionIn(workspaceId: number | null, extra: Record<string, unknown> = {}) {
    return {
        user: workspaceId === null ? null : { id: 'u1', workspace_id: workspaceId },
        workspace: workspaceId === null ? null : { id: workspaceId },
        session: workspaceId === null ? undefined : { id: 'u1', email: 'a@b.c' },
        workspaceRefused: false,
        ...extra,
    }
}

beforeEach(() => {
    mocks.getServerSession.mockReset().mockResolvedValue(sessionIn(1))
    mocks.selectSingle.mockReset()
    mocks.selectMaybeSingle.mockReset()
    mocks.selectMany.mockReset()
})

describe('requireWorkspaceId', () => {
    it('answers the workspace of the session', async () => {
        await expect(requireWorkspaceId()).resolves.toBe(1)
    })

    it('refuses a workspace the caller is not a member of as a forbidden access, not a missing identity', async () => {
        mocks.getServerSession.mockResolvedValue(sessionIn(null, { workspaceRefused: true }))
        const error = await requireWorkspaceId().catch(e => e)
        expect(error).toBeInstanceOf(AuthorizationError)
        expect(error).not.toBeInstanceOf(UnauthenticatedError)
    })

    it('throws UnauthenticatedError when the user has no workspace', async () => {
        mocks.getServerSession.mockResolvedValue({ ...sessionIn(1), user: { id: 'u1', workspace_id: null } })
        await expect(requireWorkspaceId()).rejects.toBeInstanceOf(UnauthenticatedError)
    })

    it('throws UnauthenticatedError without a user', async () => {
        mocks.getServerSession.mockResolvedValue(sessionIn(null))
        await expect(requireWorkspaceId()).rejects.toBeInstanceOf(UnauthenticatedError)
    })
})

describe('requireWorkspaceContext', () => {
    it('hands back the workspace once the membership is proven', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { role: 'member', box_scope: 'assigned' }, error: null })
        const context = await requireWorkspaceContext()
        expect(context).toMatchObject({ userId: 'u1', userEmail: 'a@b.c', workspace: { id: 1 }, role: 'member', boxScope: 'assigned', supabase: mocks.client })
        expect(mocks.selectMaybeSingle.mock.calls[0][1]).toBe('workspace_members')
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ user_id: 'u1', workspace_id: 1 })
    })

    it('refuses a stale users.workspace_id whose membership row is gone', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: null, error: null })
        const error = await requireWorkspaceContext().catch(e => e)
        expect(error).toBeInstanceOf(AuthorizationError)
        expect(error).not.toBeInstanceOf(UnauthenticatedError)
    })

    it('refuses a workspace the session refused without reading the membership', async () => {
        mocks.getServerSession.mockResolvedValue(sessionIn(null, { workspaceRefused: true }))
        await expect(requireWorkspaceContext()).rejects.toThrow('You are not a member of this workspace')
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('throws UnauthenticatedError without an auth session', async () => {
        mocks.getServerSession.mockResolvedValue({ ...sessionIn(1), session: undefined })
        await expect(requireWorkspaceContext()).rejects.toBeInstanceOf(UnauthenticatedError)
    })
})

describe('assertSpaceOwnedBy', () => {
    it('returns a Box of the given workspace', async () => {
        mocks.selectSingle.mockResolvedValue({ data: { workspace_id: 1 }, error: null })
        await expect(assertSpaceOwnedBy(1, 's1')).resolves.toEqual({ workspace_id: 1 })
    })

    it('refuses a Box from another workspace', async () => {
        mocks.selectSingle.mockResolvedValue({ data: { workspace_id: 2 }, error: null })
        await expect(assertSpaceOwnedBy(1, 's1')).rejects.toThrow('Space not found')
    })

    it('refuses a Box that does not exist', async () => {
        mocks.selectSingle.mockResolvedValue({ data: null, error: null })
        await expect(assertSpaceOwnedBy(1, 's1')).rejects.toBeInstanceOf(AuthorizationError)
    })
})

describe('assertSpaceInWorkspace', () => {
    it('refuses a Box from another workspace than the session one', async () => {
        mocks.selectSingle.mockResolvedValue({ data: { workspace_id: 2 }, error: null })
        await expect(assertSpaceInWorkspace('s1')).rejects.toThrow('Space not found')
    })
})

describe('requireAdminContext', () => {
    it('hands an admin their context', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { role: 'admin' }, error: null })
        await expect(requireAdminContext()).resolves.toMatchObject({ userId: 'u1', role: 'admin' })
    })

    it('refuses a member with the reason given', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { role: 'member' }, error: null })
        const error = await requireAdminContext('adminOnlyMembers').catch(e => e)
        expect(error).toBeInstanceOf(AuthorizationError)
        expect(error.message).toBe('Only an admin can manage members')
        expect(error.code).toBe('adminOnlyMembers')
    })
})

describe('workspaceFounderUserId', () => {
    it('answers the earliest admin, ordered by created_at', async () => {
        mocks.selectMany.mockResolvedValue({ data: [{ user_id: 'first', role: 'member' }, { user_id: 'second', role: 'admin' }, { user_id: 'third', role: 'admin' }], error: null })
        await expect(workspaceFounderUserId(1)).resolves.toBe('second')
    })

    it('falls back on the earliest member when no admin is left', async () => {
        mocks.selectMany.mockResolvedValue({ data: [{ user_id: 'first', role: 'member' }, { user_id: 'second', role: 'member' }], error: null })
        await expect(workspaceFounderUserId(1)).resolves.toBe('first')
        const [, table, , filters, orderBy] = mocks.selectMany.mock.calls[0]
        expect(table).toBe('workspace_members')
        expect(filters).toEqual({ workspace_id: 1 })
        expect(orderBy).toEqual({ column: 'created_at' })
    })

    it('answers null when the workspace has no member', async () => {
        mocks.selectMany.mockResolvedValue({ data: [], error: null })
        await expect(workspaceFounderUserId(1)).resolves.toBeNull()
    })

    it('answers null when the read fails', async () => {
        mocks.selectMany.mockResolvedValue({ data: null, error: { message: 'boom' } })
        await expect(workspaceFounderUserId(1)).resolves.toBeNull()
    })
})
