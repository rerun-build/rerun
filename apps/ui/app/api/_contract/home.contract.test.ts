import { mobileApi } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, type FakeSupabase } from '@/test/supabase-fake'

type Rows<T extends keyof Database['public']['Tables']> = Partial<Database['public']['Tables'][T]['Row']>[]

// The Home of the app: its coworkers, the latest conversation of each, the Boxes, the members, the
// account. The services run for real on a fake database; only what lies past it is replaced.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null }))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
    requireAdminContext: async () => state.ctx,
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ ...state.db?.client, auth: { getUser: async () => ({ data: { user: state.ctx?.authUser } }) } }),
    getRequestAccessToken: async () => 'token',
}))
vi.mock('@rerun/cloud/support', () => ({ SUPPORT_CHAT_ENABLED: true }))
vi.mock('@/supabase/session/getServerSession', async importOriginal => ({ ...(await importOriginal<typeof import('@/supabase/session/getServerSession')>()), getAuthUser: async () => state.ctx?.authUser }))

const agents: Rows<'agents'> = [
    { id: 'agent-scout', name: 'Scout', handle: 'scout', kind: 'coworker', description: 'Finds leads in Lyon', template_id: 'lead-finder', status: 'idle', col: 0, row: 0, workspace_id: 7, space_id: 'space-sales', disabled_at: null, disabled_reason: null },
    { id: 'agent-ledger', name: 'Ledger', handle: 'ledger', kind: 'coworker', description: null, template_id: null, status: 'idle', col: 1, row: 0, workspace_id: 7, space_id: 'space-sales', disabled_at: '2026-11-15T10:00:00.000Z', disabled_reason: 'plan_limit' },
]
const spaces: Rows<'spaces'> = [{ id: 'space-sales', workspace_id: 7, name: 'Sales', created_at: '2026-11-02T09:00:00.000Z', visibility: 'workspace' }]
const sessions: Rows<'sessions'> = [{ id: 'session-1', agent_id: 'agent-scout', origin_agent_id: null, status: 'waiting_human', updated_at: new Date().toISOString() }]

const tables = {
    agents,
    spaces,
    sessions,
    space_members: [],
    engine_pool: [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }],
    workspace_members: [
        { user_id: 'user-ada', workspace_id: 7, role: 'admin', box_scope: 'all', organization_staff: false },
        { user_id: 'user-grace', workspace_id: 7, role: 'member', box_scope: 'assigned', organization_staff: false },
    ],
    workspaces: [{ id: 7, name: 'Atelier Nord', icon_url: null, plan: 'pro', is_sandbox: false, subscription_status: 'active' }],
    user_support_tokens: [{ user_id: 'user-ada', token: '0b6c1f3e-5a2d-4c8e-9f17-3d2a6b8e4c51' }],
}

const users: Record<string, { id: string; email: string; user_metadata: Record<string, string> }> = {
    'user-ada': { id: 'user-ada', email: 'ada@atelier-nord.fr', user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://cdn.rerun.build/avatars/ada.png' } },
    'user-grace': { id: 'user-grace', email: 'grace@atelier-nord.fr', user_metadata: { full_name: 'Grace Hopper' } },
}

describe('the Home of the mobile app', () => {
    beforeEach(() => {
        const db = fakeSupabase(tableResolver(tables))
        Object.assign(db.client, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ?? null } }) } } })
        state.db = db
        state.ctx = contractContext(db)
    })

    it('lists the coworkers, a switched-off one included', async () => {
        const { GET } = await import('@/app/api/v1/agents/route')
        const board = (await expectContract(mobileApi.listAgents, await callRoute(GET, mobileApi.listAgents))) as { id: string; status: string }[]
        expect(board.map(agent => [agent.id, agent.status])).toEqual([
            ['agent-scout', 'waiting_human'],
            ['agent-ledger', 'idle'],
        ])
    })

    it('lists the Boxes the caller reaches', async () => {
        const { GET } = await import('@/app/api/v1/boxes/route')
        expect(await expectContract(mobileApi.listBoxes, await callRoute(GET, mobileApi.listBoxes))).toEqual([{ id: 'space-sales', name: 'Sales', createdAt: '2026-11-02T09:00:00.000Z', managed: true, visibility: 'workspace', access: 'manage' }])
    })

    it('lists the members with the name of their account', async () => {
        const { GET } = await import('@/app/api/v1/members/route')
        expect(await expectContract(mobileApi.listMembers, await callRoute(GET, mobileApi.listMembers))).toEqual([
            { id: 'user-ada', name: 'Ada Lovelace', avatarUrl: 'https://cdn.rerun.build/avatars/ada.png', role: 'admin' },
            { id: 'user-grace', name: 'Grace Hopper', avatarUrl: null, role: 'member' },
        ])
    })

    it('reads the account and its workspace', async () => {
        const { GET } = await import('@/app/api/v1/me/route')
        const me = (await expectContract(mobileApi.getMe, await callRoute(GET, mobileApi.getMe))) as { user: { supportChatToken?: string | null }; workspace: { subscribed: boolean } }
        expect(me.workspace.subscribed).toBe(true)
        expect(me.user.supportChatToken).toBe('0b6c1f3e-5a2d-4c8e-9f17-3d2a6b8e4c51')
    })

    it('lists the workspaces the account can switch to', async () => {
        const { GET } = await import('@/app/api/v1/workspaces/route')
        expect(await expectContract(mobileApi.listWorkspaces, await callRoute(GET, mobileApi.listWorkspaces))).toEqual([{ id: 7, name: 'Atelier Nord', iconUrl: null, plan: 'pro', subscribed: true, role: 'admin', boxScope: 'all' }])
    })
})
