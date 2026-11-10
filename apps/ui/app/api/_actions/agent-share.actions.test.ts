import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    getAdminEmail: vi.fn(),
    getServerSession: vi.fn(),
    createAgentShare: vi.fn(),
    installAgentShare: vi.fn(),
    revokeAgentShare: vi.fn(),
    listWorkspaceShares: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({ getAdminEmail: mocks.getAdminEmail }))
vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getServerSession, getSessionWorkspace: mocks.getServerSession }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/agents/share-create', () => ({ createAgentShare: mocks.createAgentShare, planAgentShare: vi.fn() }))
vi.mock('@/lib/agents/share-install', () => ({ installAgentShare: mocks.installAgentShare }))
vi.mock('@/lib/agents/share-read', () => ({ listWorkspaceShares: mocks.listWorkspaceShares, readAgentShare: vi.fn(), revokeAgentShare: mocks.revokeAgentShare }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { createAgentShareAction, installSharedAgentAction, listAgentSharesAction, revokeAgentShareAction } = await import('./agent-share.actions')

const WORKSPACE_ID = 7
const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const SPACE_ID = '22222222-2222-4222-8222-222222222222'
const SHARE_ID = '33333333-3333-4333-8333-333333333333'

type Owners = { agentWorkspace?: number; spaceWorkspace?: number; subscriptionStatus?: string | null; role?: 'admin' | 'member'; grant?: 'use' | 'manage' | null; shareAgentId?: string | null }

const OTHER_AGENT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_SPACE_ID = '55555555-5555-4555-8555-555555555555'

function database({ agentWorkspace = WORKSPACE_ID, spaceWorkspace = WORKSPACE_ID, subscriptionStatus = 'active', role = 'admin', grant = null, shareAgentId = AGENT_ID }: Owners = {}): FakeSupabase {
    mocks.getServerSession.mockResolvedValue({ ...SESSION, membership: { role, box_scope: 'all' } })
    const db = fakeSupabase((table, calls) => {
        const single = calls.some(call => call.method === 'maybeSingle' || call.method === 'single')
        if (table === 'workspace_members') return { data: { user_id: 'user-1', role, box_scope: 'all' } }
        if (table === 'agents') return single ? { data: { workspace_id: agentWorkspace, space_id: SPACE_ID, engine_agent_id: 'engine-1' } } : { data: [{ id: AGENT_ID }] }
        if (table === 'spaces') {
            return single
                ? { data: { id: SPACE_ID, workspace_id: spaceWorkspace, visibility: 'workspace' } }
                : {
                      data: [
                          { id: SPACE_ID, workspace_id: spaceWorkspace, visibility: 'workspace' },
                          { id: OTHER_SPACE_ID, workspace_id: spaceWorkspace, visibility: 'workspace' },
                      ],
                  }
        }
        if (table === 'space_members') return single ? { data: grant ? { access: grant } : null } : { data: grant ? [{ space_id: SPACE_ID, access: grant }] : [] }
        if (table === 'agent_shares') return { data: { source_agent_id: shareAgentId } }
        if (table === 'workspaces') return { data: { subscription_status: subscriptionStatus } }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

const SESSION = {
    user: { id: 'user-1', workspace_id: WORKSPACE_ID },
    workspace: { id: WORKSPACE_ID, name: 'Acme' },
    session: { id: 'user-1', email: 'me@acme.test' },
    workspaceRefused: false,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminEmail.mockResolvedValue(null)
    mocks.createAgentShare.mockResolvedValue({ url: 'https://app.rerun.build/s/tok', warnings: [], reused: false })
    mocks.installAgentShare.mockResolvedValue({ agentId: 'new-agent' })
})

describe('createAgentShareAction', () => {
    it('refuses an agent of another workspace without creating a share', async () => {
        database({ agentWorkspace: 99 })

        await expect(createAgentShareAction({ agentId: AGENT_ID, include: {} })).resolves.toEqual({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound' })
        expect(mocks.createAgentShare).not.toHaveBeenCalled()
    })

    it('creates the share for the caller workspace', async () => {
        database()

        await expect(createAgentShareAction({ agentId: AGENT_ID, include: { files: false } })).resolves.toEqual({ ok: true, url: 'https://app.rerun.build/s/tok', warnings: [], reused: false })
        expect(mocks.createAgentShare.mock.calls[0][1]).toEqual({ agentRowId: AGENT_ID, workspaceId: WORKSPACE_ID, userId: 'user-1', include: { memories: false, database: false, files: false } })
    })

    it('refuses a member who only uses the Box: a link exports the whole coworker', async () => {
        database({ role: 'member' })

        await expect(createAgentShareAction({ agentId: AGENT_ID, include: {} })).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(mocks.createAgentShare).not.toHaveBeenCalled()
    })

    it('lets a member who manages the Box share its coworker', async () => {
        database({ role: 'member', grant: 'manage' })

        await expect(createAgentShareAction({ agentId: AGENT_ID, include: {} })).resolves.toMatchObject({ ok: true })
    })
})

describe('listAgentSharesAction', () => {
    const shares = [
        { id: 'share-1', sourceAgentId: AGENT_ID },
        { id: 'share-2', sourceAgentId: OTHER_AGENT_ID },
        { id: 'share-3', sourceAgentId: null },
    ]

    it('hands an admin every link of the workspace', async () => {
        database()
        mocks.listWorkspaceShares.mockResolvedValue(shares)

        await expect(listAgentSharesAction()).resolves.toEqual({ ok: true, shares })
    })

    it('hands a member only the links of the coworkers they manage', async () => {
        database({ role: 'member', grant: 'manage' })
        mocks.listWorkspaceShares.mockResolvedValue(shares)

        await expect(listAgentSharesAction()).resolves.toEqual({ ok: true, shares: [shares[0]] })
    })
})

describe('installSharedAgentAction', () => {
    it('refuses a Box of another workspace', async () => {
        database({ spaceWorkspace: 99 })

        await expect(installSharedAgentAction({ token: 'tok', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'Box not found', code: 'boxNotFound' })
        expect(mocks.installAgentShare).not.toHaveBeenCalled()
    })

    it('refuses a member who only uses the Box', async () => {
        database({ role: 'member' })

        await expect(installSharedAgentAction({ token: 'tok', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(mocks.installAgentShare).not.toHaveBeenCalled()
    })

    it('refuses a workspace with no active plan', async () => {
        database({ subscriptionStatus: 'canceled' })

        await expect(installSharedAgentAction({ token: 'tok', spaceId: SPACE_ID })).resolves.toEqual({ ok: false, error: 'This workspace has no active plan.', code: 'noActivePlan' })
        expect(mocks.installAgentShare).not.toHaveBeenCalled()
    })

    it('lets an admin install without a plan', async () => {
        mocks.getAdminEmail.mockResolvedValue('admin@rerun.build')
        const db = database({ subscriptionStatus: null })

        await expect(installSharedAgentAction({ token: 'tok', spaceId: SPACE_ID })).resolves.toEqual({ ok: true, agentId: 'new-agent' })
        expect(db.chainsOn('workspaces')).toHaveLength(0)
    })

    it('installs on a trialing workspace, into the Box it was asked for', async () => {
        database({ subscriptionStatus: 'trialing' })

        await expect(installSharedAgentAction({ token: 'tok', spaceId: SPACE_ID, position: { col: 1, row: 2 } })).resolves.toEqual({ ok: true, agentId: 'new-agent' })
        expect(mocks.installAgentShare).toHaveBeenCalledWith(expect.anything(), 'tok', { workspaceId: WORKSPACE_ID, spaceId: SPACE_ID, actor: expect.objectContaining({ userId: 'user-1', workspaceId: WORKSPACE_ID }), position: { col: 1, row: 2 } })
    })
})

describe('revokeAgentShareAction', () => {
    it('scopes the revocation to the caller workspace', async () => {
        database()

        await expect(revokeAgentShareAction(SHARE_ID)).resolves.toEqual({ ok: true })
        expect(mocks.revokeAgentShare).toHaveBeenCalledWith(expect.anything(), SHARE_ID, WORKSPACE_ID)
    })

    it('refuses a member who only uses the Box of the shared coworker', async () => {
        database({ role: 'member' })

        await expect(revokeAgentShareAction(SHARE_ID)).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(mocks.revokeAgentShare).not.toHaveBeenCalled()
    })

    it('leaves the link of a deleted coworker to the admins', async () => {
        database({ role: 'member', grant: 'manage', shareAgentId: null })

        await expect(revokeAgentShareAction(SHARE_ID)).resolves.toEqual({ ok: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(mocks.revokeAgentShare).not.toHaveBeenCalled()
    })

    it('refuses an id that is not a uuid', async () => {
        database()

        await expect(revokeAgentShareAction('nope')).resolves.toMatchObject({ ok: false })
        expect(mocks.revokeAgentShare).not.toHaveBeenCalled()
    })
})
