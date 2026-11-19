import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    requestedWorkspaceId: null as number | null,
    memberOf: new Set<number>(),
    selectMaybeSingle: vi.fn(),
    selectSingle: vi.fn(),
    getClaims: vi.fn(),
    getUser: vi.fn(),
}))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } }),
    getRequestAccessToken: async () => 'token',
    getRequestWorkspaceId: async () => mocks.requestedWorkspaceId,
}))
vi.mock('../supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectSingle: mocks.selectSingle }))

const { getAuthUser, getServerSession, getSessionIdentity, getSessionWorkspace } = await import('./getServerSession')

describe('getServerSession', () => {
    beforeEach(() => {
        mocks.requestedWorkspaceId = null
        mocks.memberOf = new Set([1, 2])
        mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u1', email: 'me@acme.test', is_anonymous: false, user_metadata: { name: 'Me' }, app_metadata: { provider: 'email' } } }, error: null })
        mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'me@acme.test', identities: [] } } })
        mocks.selectSingle.mockReset().mockImplementation(async (_client: unknown, table: string, _columns: unknown, filters: { id?: number }) =>
            table === 'users' ? { data: { id: 'u1', workspace_id: 1 } } : { data: { id: filters.id, name: `ws ${filters.id}` } }
        )
        mocks.selectMaybeSingle.mockReset().mockImplementation(async (_client: unknown, _table: string, _columns: unknown, filters: { workspace_id: number }) => ({
            data: mocks.memberOf.has(filters.workspace_id) ? { workspace_id: filters.workspace_id } : null,
        }))
    })

    it('follows the stored workspace when the request names none, once the membership confirms it', async () => {
        const session = await getServerSession()
        expect(session.user?.workspace_id).toBe(1)
        expect(session.workspace?.id).toBe(1)
        expect(session.workspaceRefused).toBe(false)
        expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ user_id: 'u1', workspace_id: 1 })
    })

    it('refuses a stored workspace the caller is not a member of', async () => {
        mocks.memberOf = new Set([2])
        const session = await getServerSession()
        expect(session.workspaceRefused).toBe(true)
        expect(session.user).toBeNull()
        expect(session.workspace).toBeNull()
    })

    it('switches to a workspace the caller belongs to', async () => {
        mocks.requestedWorkspaceId = 2
        const session = await getServerSession()
        expect(session.user?.workspace_id).toBe(2)
        expect(session.workspace?.id).toBe(2)
        expect(session.workspaceRefused).toBe(false)
    })

    it('refuses a workspace the caller does not belong to', async () => {
        mocks.requestedWorkspaceId = 3
        const session = await getServerSession()
        expect(session.workspaceRefused).toBe(true)
        expect(session.user).toBeNull()
        expect(session.workspace).toBeNull()
    })

    it('refuses a malformed workspace id without querying it', async () => {
        mocks.requestedWorkspaceId = Number.NaN
        const session = await getServerSession()
        expect(session.workspaceRefused).toBe(true)
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('reads the identity off the token, with no call to the auth server', async () => {
        const session = await getServerSession()
        expect(session.session).toEqual({ id: 'u1', email: 'me@acme.test', is_anonymous: false, user_metadata: { name: 'Me' }, app_metadata: { provider: 'email' } })
        expect(mocks.getClaims).toHaveBeenCalledWith('token')
        expect(mocks.getUser).not.toHaveBeenCalled()
    })

    it('hands back the role the membership carries', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { workspace_id: 1, role: 'admin', box_scope: 'all' } })
        const session = await getServerSession()
        expect(session.membership).toEqual({ role: 'admin', box_scope: 'all' })
    })

    it('asks for the user row, the membership and the workspace of a named workspace together', async () => {
        mocks.requestedWorkspaceId = 2
        let releaseUser!: () => void
        const userRead = new Promise<void>(resolve => (releaseUser = resolve))
        mocks.selectSingle.mockImplementation(async (_client: unknown, table: string, _columns: unknown, filters: { id?: number }) => {
            if (table !== 'users') return { data: { id: filters.id, name: `ws ${filters.id}` } }
            await userRead
            return { data: { id: 'u1', workspace_id: 1 } }
        })

        const pending = getServerSession()
        await vi.waitFor(() => expect(mocks.selectSingle).toHaveBeenCalledTimes(2))
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ user_id: 'u1', workspace_id: 2 })
        expect(mocks.selectSingle.mock.calls.map(call => call[1]).sort()).toEqual(['users', 'workspaces'])

        releaseUser()
        const session = await pending
        expect(session.workspace?.id).toBe(2)
        expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
        expect(mocks.selectSingle).toHaveBeenCalledTimes(2)
    })

    it('does not accept a membership read for another account than the row PostgREST answered', async () => {
        mocks.requestedWorkspaceId = 2
        mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'someone-else' } }, error: null })
        const session = await getServerSession()
        expect(session.user?.workspace_id).toBe(2)
        expect(mocks.selectMaybeSingle.mock.calls.at(-1)?.[3]).toEqual({ user_id: 'u1', workspace_id: 2 })
    })

    it('still resolves the workspace through the row when the token cannot be verified here, and carries no identity', async () => {
        mocks.requestedWorkspaceId = 2
        mocks.getClaims.mockResolvedValue({ data: null, error: null })
        const session = await getServerSession()
        expect(session.session).toBeNull()
        expect(session.user?.workspace_id).toBe(2)
        expect(session.workspace?.id).toBe(2)
    })

    it('reads no workspace row for a caller without a user row', async () => {
        mocks.selectSingle.mockImplementation(async () => ({ data: null }))
        const session = await getServerSession()
        expect(session.user).toBeNull()
        expect(session.workspace).toBeNull()
        expect(mocks.selectSingle.mock.calls.map(call => call[1])).toEqual(['users'])
    })
})

describe('getSessionWorkspace', () => {
    beforeEach(() => {
        mocks.requestedWorkspaceId = 1
        mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u1' } }, error: null })
        mocks.selectSingle.mockReset().mockResolvedValue({ data: { id: 'u1', workspace_id: 1 } })
        mocks.selectMaybeSingle.mockReset().mockResolvedValue({ data: { workspace_id: 1, role: 'member', box_scope: 'assigned' } })
    })

    it('stops at the user row and the membership', async () => {
        const session = await getSessionWorkspace()
        expect(session.user?.workspace_id).toBe(1)
        expect(session.membership).toEqual({ role: 'member', box_scope: 'assigned' })
        expect(mocks.selectSingle.mock.calls.map(call => call[1])).toEqual(['users'])
    })
})

describe('getAuthUser', () => {
    it('asks the auth server for the account, with the token of the request', async () => {
        mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', identities: [{ provider: 'google' }] } } })
        await expect(getAuthUser()).resolves.toEqual({ id: 'u1', identities: [{ provider: 'google' }] })
        expect(mocks.getUser).toHaveBeenCalledWith('token')
    })
})

describe('getSessionIdentity', () => {
    beforeEach(() => {
        mocks.getUser.mockReset()
        mocks.selectSingle.mockReset()
        mocks.selectMaybeSingle.mockReset()
    })

    it('answers from the verified token alone: no auth server, no table', async () => {
        mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u1', email: 'me@acme.test', is_anonymous: true } }, error: null })
        await expect(getSessionIdentity()).resolves.toMatchObject({ id: 'u1', email: 'me@acme.test', is_anonymous: true })
        expect(mocks.getClaims).toHaveBeenCalledWith('token')
        expect(mocks.getUser).not.toHaveBeenCalled()
        expect(mocks.selectSingle).not.toHaveBeenCalled()
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('answers null for a token that does not verify', async () => {
        mocks.getClaims.mockReset().mockRejectedValue(new Error('invalid JWT'))
        await expect(getSessionIdentity()).resolves.toBeNull()
    })
})
