import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase } from '@/test/supabase-fake'
import type { Actor } from '@/app/api/_auth/access'

const mocks = vi.hoisted(() => ({
    createAgentShare: vi.fn(),
    planAgentShare: vi.fn(),
    listWorkspaceShares: vi.fn(),
    revokeAgentShare: vi.fn(),
    dispatchTemplateTool: vi.fn(),
}))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: vi.fn(), getSessionWorkspace: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/agents/share-create', () => ({ createAgentShare: mocks.createAgentShare, planAgentShare: mocks.planAgentShare }))
vi.mock('@/lib/agents/share-read', () => ({ listWorkspaceShares: mocks.listWorkspaceShares, revokeAgentShare: mocks.revokeAgentShare }))
vi.mock('./mcp-templates.service', () => ({ dispatchTemplateTool: mocks.dispatchTemplateTool }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { dispatchShareTool } = await import('./mcp-shares.service')

const WORKSPACE_ID = 7
const MEMBER_ID = 'member-1'
const FOUNDER_ID = 'founder-1'
const AGENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_AGENT_ID = '44444444-4444-4444-8444-444444444444'
const SPACE_ID = '22222222-2222-4222-8222-222222222222'
const SHARE_ID = '33333333-3333-4333-8333-333333333333'

const MEMBER: Actor = { kind: 'user', userId: MEMBER_ID, workspaceId: WORKSPACE_ID, role: 'member', boxScope: 'all' }
const API_KEY: Actor = { kind: 'workspace', workspaceId: WORKSPACE_ID }

type Box = { visibility?: 'workspace' | 'restricted'; grant?: 'use' | 'manage' | null }

function database({ visibility = 'workspace', grant = null }: Box = {}) {
    const db = fakeSupabase((table, calls) => {
        const single = calls.some(call => call.method === 'maybeSingle' || call.method === 'single')
        if (table === 'agents') return single ? { data: { workspace_id: WORKSPACE_ID, space_id: SPACE_ID, engine_agent_id: 'engine-1' } } : { data: [{ id: AGENT_ID }] }
        if (table === 'spaces') return single ? { data: { id: SPACE_ID, workspace_id: WORKSPACE_ID, visibility } } : { data: [{ id: SPACE_ID, workspace_id: WORKSPACE_ID, visibility }] }
        if (table === 'space_members') return single ? { data: grant ? { access: grant } : null } : { data: grant ? [{ space_id: SPACE_ID, access: grant }] : [] }
        if (table === 'agent_shares') return { data: single ? { id: SHARE_ID, source_agent_id: AGENT_ID } : [] }
        if (table === 'workspace_members') return { data: [{ user_id: FOUNDER_ID, role: 'admin' }] }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

function share(agentId: string) {
    return { id: `share-${agentId}`, url: `https://app.rerun.build/s/${agentId}`, sourceAgentId: agentId, agentName: agentId, createdAt: '2026-11-05', installCount: 0, include: {} }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAgentShare.mockResolvedValue({ token: 'tok', url: 'https://app.rerun.build/s/tok', warnings: [], reused: false })
    mocks.planAgentShare.mockResolvedValue({ agentName: 'Scout', contents: [], envKeyCount: 0, mcpAuthCount: 0, warnings: [] })
    mocks.listWorkspaceShares.mockResolvedValue([share(AGENT_ID), share(OTHER_AGENT_ID)])
})

describe('dispatchShareTool for a member', () => {
    it('answers a coworker of a Box they do not reach as if it did not exist', async () => {
        database({ visibility: 'restricted' })

        await expect(dispatchShareTool(MEMBER, 'create_agent_share', { agentId: AGENT_ID })).rejects.toThrow('Coworker not found')
        await expect(dispatchShareTool(MEMBER, 'plan_agent_share', { agentId: AGENT_ID })).rejects.toThrow('Coworker not found')
        expect(mocks.createAgentShare).not.toHaveBeenCalled()
        expect(mocks.planAgentShare).not.toHaveBeenCalled()
    })

    it('refuses to share a coworker of a Box they only use', async () => {
        database()

        await expect(dispatchShareTool(MEMBER, 'create_agent_share', { agentId: AGENT_ID })).rejects.toThrow('Only an admin or a manager of this Box can do this')
        expect(mocks.createAgentShare).not.toHaveBeenCalled()
    })

    it('shares a coworker of a Box they manage, in their own name', async () => {
        database({ grant: 'manage' })

        await dispatchShareTool(MEMBER, 'create_agent_share', { agentId: AGENT_ID })

        expect(mocks.createAgentShare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentRowId: AGENT_ID, workspaceId: WORKSPACE_ID, userId: MEMBER_ID }))
    })

    it('lists only the links of the coworkers they manage', async () => {
        database({ grant: 'manage' })

        const result = (await dispatchShareTool(MEMBER, 'list_agent_shares', {})) as { shares: { agentId: string }[]; activeCount: number }

        expect(result.shares.map(entry => entry.agentId)).toEqual([AGENT_ID])
        expect(result.activeCount).toBe(1)
    })

    it('cannot revoke the link of a coworker they do not reach', async () => {
        database({ visibility: 'restricted' })

        await expect(dispatchShareTool(MEMBER, 'revoke_agent_share', { shareId: SHARE_ID, confirm: true })).rejects.toThrow('Coworker not found')
        expect(mocks.revokeAgentShare).not.toHaveBeenCalled()
    })
})

describe('dispatchShareTool for an API key', () => {
    it('reaches every coworker and signs a link with the founder', async () => {
        database({ visibility: 'restricted' })

        await dispatchShareTool(API_KEY, 'create_agent_share', { agentId: AGENT_ID })

        expect(mocks.createAgentShare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: FOUNDER_ID }))
    })

    it('lists every link of the workspace', async () => {
        database()

        const result = (await dispatchShareTool(API_KEY, 'list_agent_shares', {})) as { activeCount: number }

        expect(result.activeCount).toBe(2)
    })
})
