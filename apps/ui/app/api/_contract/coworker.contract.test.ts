import { agentDetailSchema, agentModelsSchema, agentViewSchema, connectionsListSchema, mobileApi } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import type { ServiceRegistry } from '@/lib/services/registry'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { shippedIosAgentModelsSchema, shippedIosAgentViewSchema } from '@/test/shipped-ios'
import { fakeSupabase, tableResolver, type FakeSupabase, type SupabaseResolver } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Rows<T extends keyof Tables> = Partial<Tables[T]['Row']>[]
type Engine = typeof import('@/lib/engine/client')
type SessionWorkspace = Awaited<ReturnType<typeof import('@/supabase/session/getServerSession').getSessionWorkspace>>

// One coworker as the app opens it: its sheet, its model, its keys, its files, its apps, its
// routines, its conversations and its screen. The services and actions run for real on a fake
// database; the engine of the workspace's machine is replaced at its HTTP client, and what lies past
// the hub (the AI calls of the kickoff, the relay of Rerun Cloud's hosts) is pinned.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null, rows: {} as Record<string, object[]> }))

const engine = vi.hoisted(() => ({
    getAgent: vi.fn<Engine['getAgent']>(),
    createAgent: vi.fn<Engine['createAgent']>(),
    deleteAgent: vi.fn<Engine['deleteAgent']>(),
    patchAgent: vi.fn<Engine['patchAgent']>(),
    getAgentKeys: vi.fn<Engine['getAgentKeys']>(),
    updateAgentKeys: vi.fn<Engine['updateAgentKeys']>(),
    listConnections: vi.fn<Engine['listConnections']>(),
    listSessions: vi.fn<Engine['listSessions']>(),
    listFiles: vi.fn<Engine['listFiles']>(),
    readFileText: vi.fn<Engine['readFileText']>(),
    supportsVault: vi.fn<Engine['supportsVault']>(),
    listSchedules: vi.fn<Engine['listSchedules']>(),
    listTriggers: vi.fn<Engine['listTriggers']>(),
    updateSchedule: vi.fn<Engine['updateSchedule']>(),
    updateTrigger: vi.fn<Engine['updateTrigger']>(),
    listSkillSummaries: vi.fn<Engine['listSkillSummaries']>(),
    cancelSubRun: vi.fn<Engine['cancelSubRun']>(),
    supportsDesktop: vi.fn<Engine['supportsDesktop']>(),
    startDesktop: vi.fn<Engine['startDesktop']>(),
    startTakeover: vi.fn<Engine['startTakeover']>(),
    finishTakeover: vi.fn<Engine['finishTakeover']>(),
    setBrainAgentBoxes: vi.fn<Engine['setBrainAgentBoxes']>(),
    chat: vi.fn<Engine['chat']>(),
}))

vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<Engine>()), ...engine }))
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
// The actions (desktop, sub-run) and the kickoff resolve their caller from the session, as the web does.
vi.mock('@/supabase/session/getServerSession', async importOriginal => ({
    ...(await importOriginal<typeof import('@/supabase/session/getServerSession')>()),
    getAuthUser: async () => state.ctx?.authUser,
    getSessionWorkspace: async (): Promise<SessionWorkspace> => {
        const ctx = state.ctx as WorkspaceContext
        return { supabase: ctx.supabase, user: { id: ctx.userId, workspace_id: ctx.workspace.id, email_notification_prefs: null, locale: null }, workspaceRefused: false, membership: { role: ctx.role, box_scope: ctx.boxScope } }
    },
}))
vi.mock('@rerun/cloud/billing', async importOriginal => ({
    ...(await importOriginal<typeof import('@rerun/cloud/billing')>()),
    activeAgentLimitFor: ((maxAgents: number | null) => maxAgents) satisfies typeof import('@rerun/cloud/billing').activeAgentLimitFor,
}))
vi.mock('@rerun/cloud/engines', async importOriginal => ({
    ...(await importOriginal<typeof import('@rerun/cloud/engines')>()),
    DESKTOP_DIRECT: false,
    desktopRelayBase: (async () => 'wss://relay-01.rerun.build/box/3') satisfies typeof import('@rerun/cloud/engines').desktopRelayBase,
}))
vi.mock('@/lib/ai/reformulate-kickoff', () => ({
    reformulateKickoff: (async () => 'Find bakeries in Lyon that need a new website, and get yourself set up for it.') satisfies typeof import('@/lib/ai/reformulate-kickoff').reformulateKickoff,
}))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: (async () => 'Bakeries in Lyon') satisfies typeof import('@/lib/ai/generate-title').generateSessionTitle }))

const SPACE = '3f2b8c1e-6a4d-4e9b-8f7a-2c5d1e9b0a47'
const SCOUT = '8d4e2a1f-3b6c-4d7e-9a8b-1c2d3e4f5a6b'
const LEDGER = 'b7c6d5e4-f3a2-4b1c-8d9e-0f1a2b3c4d5e'
const STRANGER = 'e1d2c3b4-a5f6-4e7d-8c9b-0a1b2c3d4e5f'
const GENERAL = 'c4a1e2b3-5d6f-4a7b-8c9d-0e1f2a3b4c5d'
const THREAD = 'f6e5d4c3-b2a1-4f0e-9d8c-7b6a5f4e3d2c'
const CREATED: Record<string, string> = { agents: '0a9b8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d', sessions: '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e' }

const agents: Rows<'agents'> = [
    { id: SCOUT, name: 'Scout', handle: 'scout', description: 'Finds leads in Lyon', template_id: 'lead-finder', status: 'idle', col: 0, row: 0, workspace_id: 7, space_id: SPACE, engine_agent_id: 'scout', disabled_at: null, disabled_reason: null, created_at: '2026-11-03T10:00:00.000Z' },
    { id: LEDGER, name: 'Ledger', handle: 'ledger', description: null, template_id: null, status: 'idle', col: 2, row: 0, workspace_id: 7, space_id: SPACE, engine_agent_id: 'ledger', disabled_at: '2026-11-15T10:00:00.000Z', disabled_reason: 'plan_limit', created_at: '2026-11-04T10:00:00.000Z' },
    { id: STRANGER, name: 'Scout', handle: 'scout', description: null, template_id: null, status: 'idle', col: 0, row: 0, workspace_id: 9, space_id: '9c8b7a6f-5e4d-4c3b-8a2f-1e0d9c8b7a6f', engine_agent_id: 'scout', disabled_at: null, disabled_reason: null, created_at: '2026-11-05T10:00:00.000Z' },
]
const spaces: Rows<'spaces'> = [{ id: SPACE, workspace_id: 7, name: 'Sales', visibility: 'workspace', col_start: 0, row_start: 0, col_end: 7, row_end: 7, created_at: '2026-11-02T09:00:00.000Z' }]
const sessions: Rows<'sessions'> = [
    { id: GENERAL, agent_id: SCOUT, engine_session_id: 'eng-general', title: 'General', status: 'idle', source: 'dashboard', kind: 'general', origin_agent_id: null, automation_name: null, outcome: null, first_message: null, created_at: '2026-11-03T10:05:00.000Z', updated_at: '2026-11-18T08:00:00.000Z' },
    { id: THREAD, agent_id: SCOUT, engine_session_id: 'eng-thread', title: 'Bakeries in Lyon', status: 'awaiting_question', source: 'dashboard', kind: 'thread', origin_agent_id: null, automation_name: null, outcome: null, first_message: 'Find bakeries in Lyon', created_at: '2026-11-18T09:00:00.000Z', updated_at: '2026-11-18T09:30:00.000Z' },
]
const notifications: Rows<'notifications'> = [
    { id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', workspace_id: 7, agent_id: SCOUT, engine_agent_id: 'scout', engine_session_id: 'eng-thread', event: 'agent.question', kind: 'question', message: 'Should I include the bakeries of Villeurbanne?', metadata: null, recipients: null, created_at: '2026-11-18T09:30:00.000Z' },
]
const unseenRuns: Database['public']['Functions']['unseen_runs']['Returns'] = [
    { agent_id: SCOUT, session_id: GENERAL, last_at: '2026-11-18T08:00:00.000Z', message: 'Your weekly list is ready.', run_count: 1, slug: 'weekly-leads', source: 'schedule', title: 'Weekly leads' },
]

const workspace = (maxAgents: number): Rows<'workspaces'>[number] => ({ id: 7, name: 'Atelier Nord', max_agents: maxAgents, subscription_status: 'active', locale: 'en' })

function database(): FakeSupabase {
    state.rows = {
        agents: agents.map(row => ({ ...row })),
        spaces,
        sessions: sessions.map(row => ({ ...row })),
        notifications,
        space_members: [],
        users: [{ id: 'user-ada', locale: null }] satisfies Rows<'users'>,
        services: [{ slug: 'hubspot', name: 'HubSpot', icon: 'https://cdn.rerun.build/services/hubspot.svg', category: 'crm', enabled: true }] satisfies Rows<'services'>,
        engine_pool: [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'box-key', provider_server_id: 'srv-1', host_id: 'host-01', box_index: 3, claimed_by_workspace_id: 7 }] satisfies Rows<'engine_pool'>,
        workspaces: [workspace(10)],
        'rpc:unseen_runs': unseenRuns,
        // Each coworker's latest conversation and the last thing said in it, as the database function reads them.
        'rpc:coworker_previews': [
            { agent_id: SCOUT, session_id: THREAD, title: 'Bakeries in Lyon', status: 'awaiting_question', updated_at: '2026-11-18T09:30:00.000Z', last_message: 'Should I include the bakeries of Villeurbanne?', last_message_from: 'agent', last_message_at: '2026-11-18T09:30:00.000Z', last_message_author_id: null },
            { agent_id: LEDGER, session_id: null, title: null, status: null, updated_at: null, last_message: null, last_message_from: null, last_message_at: null, last_message_author_id: null },
        ],
    }
    const read = tableResolver(state.rows)
    // An inserted coworker or conversation is there for the next read, with the id the database gives it.
    const resolve: SupabaseResolver = (table, calls) => {
        const insert = calls.find(call => call.method === 'insert')
        if (insert && CREATED[table]) {
            const row = { id: CREATED[table], created_at: new Date().toISOString(), ...(insert.args[0] as object) }
            state.rows[table].push(row)
            return { data: row }
        }
        return read(table, calls)
    }
    return fakeSupabase(resolve)
}

const scoutDetail = agentDetailSchema.parse({
    id: 'scout',
    config: { name: 'scout', displayName: 'Scout', description: 'Finds leads in Lyon', connectionId: 'cnx-oc', provider: 'opencode', model: 'go/glm-5.3' },
    soul: '# Scout\nYou find the bakeries and restaurants of Lyon that need a new website.',
    resolvedConnectionId: 'cnx-oc',
    resolvedProvider: 'opencode',
    resolvedModel: 'go/glm-5.3',
} satisfies z.input<typeof agentDetailSchema>)

const connections = connectionsListSchema.parse({
    connections: [
        { id: 'rerun', name: 'Rerun', provider: 'rerun', models: ['rerun-fast', 'rerun-max'], createdAt: '2026-11-02T09:00:00.000Z', connected: true },
        { id: 'cnx-oc', name: 'OpenCode Go', provider: 'opencode', models: ['go/deepseek-v4-pro', 'go/glm-5.3'], createdAt: '2026-11-10T14:00:00.000Z', connected: true },
    ],
    default: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' },
} satisfies z.input<typeof connectionsListSchema>)

const engineSessions: Awaited<ReturnType<Engine['listSessions']>> = [
    { id: 'eng-general', agentId: 'scout', title: 'General', status: 'open', source: 'dashboard', originAgentId: null, originSessionId: null, createdAt: '2026-11-03T10:05:00.000Z', updatedAt: '2026-11-18T08:00:00.000Z' },
    { id: 'eng-thread', agentId: 'scout', title: 'Bakeries in Lyon', status: 'open', source: 'dashboard', originAgentId: null, originSessionId: null, createdAt: '2026-11-18T09:00:00.000Z', updatedAt: '2026-11-18T09:30:00.000Z' },
    { id: 'eng-from-ledger', agentId: 'scout', title: 'Unpaid invoices of October', status: 'open', source: 'agent', originAgentId: 'ledger', originSessionId: 'eng-ledger-1', createdAt: '2026-11-17T16:00:00.000Z', updatedAt: '2026-11-17T16:10:00.000Z' },
]

const registry: ServiceRegistry = {
    services: {
        hubspot: { status: 'active', config: {}, authMethodId: 'oauth', mcpServers: ['hubspot'], envKeys: [], skills: [], oauth: { serverName: 'hubspot', url: 'https://mcp.hubspot.com/mcp' }, installedAt: '2026-11-06T11:00:00.000Z' },
    },
}

const schedules: Awaited<ReturnType<Engine['listSchedules']>> = [
    { slug: 'weekly-leads', name: 'Weekly leads', description: '', enabled: true, cron: '0 9 * * 1', runAt: null, timezone: 'Europe/Paris', lastRunAt: '2026-11-17T08:00:00.000Z', connectionId: null, provider: null, model: null, body: 'List 20 new bakeries in Lyon.', createdAt: '2026-11-06T11:00:00.000Z' },
]
const triggers: Awaited<ReturnType<Engine['listTriggers']>> = [
    { slug: 'new-lead', name: 'New lead', description: '', enabled: false, token: 'tok_9f8e7d', methods: ['POST'], lastFiredAt: null, fireCount: 0, connectionId: null, provider: null, model: null, body: 'Qualify the lead in the payload.', createdAt: '2026-11-07T11:00:00.000Z' },
]

const filesByFolder: Record<string, Awaited<ReturnType<Engine['listFiles']>>> = {
    '.': [
        { name: 'report.pdf', type: 'file', size: 48_213, modifiedAt: '2026-11-17T18:00:00.000Z' },
        { name: 'leads', type: 'dir', size: 0 },
        { name: '.rerun', type: 'dir', size: 0 },
        { name: 'node_modules', type: 'dir', size: 0 },
    ],
    leads: [
        { name: 'lyon.csv', type: 'file', size: 1_204, modifiedAt: '2026-11-18T09:20:00.000Z' },
        { name: 'storefront.jpg', type: 'file', size: 310_552, modifiedAt: '2026-11-16T12:00:00.000Z' },
    ],
}

const OLD_IOS = 'ios/1.3.2 (35)'
const CURRENT_IOS = 'ios/1.4.0 (40)'

describe('a coworker in the mobile app', () => {
    beforeEach(() => {
        for (const fn of Object.values(engine)) fn.mockReset()
        vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
            throw new Error(`No request leaves a contract test: ${String(input)}`)
        })
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        engine.getAgent.mockResolvedValue(scoutDetail)
        engine.createAgent.mockImplementation(async (_conn, params) => agentDetailSchema.parse({ id: params.config.name, config: { name: params.config.name, displayName: params.config.displayName }, soul: '' }))
        engine.deleteAgent.mockResolvedValue()
        engine.setBrainAgentBoxes.mockResolvedValue()
        engine.patchAgent.mockResolvedValue(scoutDetail)
        engine.listConnections.mockResolvedValue(connections)
        engine.listSessions.mockResolvedValue(engineSessions)
        engine.listFiles.mockImplementation(async (_conn, _base, folder) => filesByFolder[folder] ?? [])
        engine.readFileText.mockResolvedValue({ path: '.rerun/services.json', content: JSON.stringify(registry) })
        engine.supportsVault.mockResolvedValue(false)
        engine.listSchedules.mockResolvedValue(schedules)
        engine.listTriggers.mockResolvedValue(triggers)
        engine.supportsDesktop.mockResolvedValue(true)
        engine.startDesktop.mockResolvedValue({ available: true, screens: [{ agentId: 'scout', viewers: 0, takeover: false, dock: true, agentDriving: false }] })
        engine.chat.mockResolvedValue(new Response('', { headers: { 'x-session-id': 'eng-kickoff', 'x-run-id': 'run_01JDKICK' } }))
        const db = database()
        state.db = db
        state.ctx = contractContext(db)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    describe('its creation', () => {
        it('creates it in a Box and sends it its first message', async () => {
            const { POST } = await import('@/app/api/v1/agents/route')
            const res = await callRoute(POST, mobileApi.createAgent, { body: { name: 'Relance Devis', description: 'Follow up on the quotes nobody answered', spaceId: SPACE } })
            expect(await expectContract(mobileApi.createAgent, res)).toEqual({ agentId: CREATED.agents, active: true, sessionId: CREATED.sessions, runId: 'run_01JDKICK' })
            expect(engine.createAgent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ config: expect.objectContaining({ displayName: 'Relance Devis', enabled: true }) }))
            expect(engine.chat).toHaveBeenCalledWith(expect.anything(), 'relance_devis', expect.objectContaining({ author: { id: 'user-ada', name: 'Ada Lovelace' } }))
        })

        it('creates it switched off, with nothing sent, when the plan has no free slot', async () => {
            state.rows.workspaces = [workspace(1)]
            const { POST } = await import('@/app/api/v1/agents/route')
            const res = await callRoute(POST, mobileApi.createAgent, { body: { name: 'Relance Devis', description: 'Follow up on the quotes nobody answered', spaceId: SPACE } })
            expect(await expectContract(mobileApi.createAgent, res)).toEqual({ agentId: CREATED.agents, active: false, sessionId: null, runId: null })
            expect(engine.chat).not.toHaveBeenCalled()
        })
    })

    it('lists each coworker with its latest conversation and what waits on a human', async () => {
        const { GET } = await import('@/app/api/v1/agents/conversations/route')
        const overview = (await expectContract(mobileApi.getConversationsOverview, await callRoute(GET, mobileApi.getConversationsOverview))) as { agentId: string; latest: { id: string; lastMessage?: { text: string; mine: boolean } | null } | null; pending: number; generalSessionId?: string | null }[]
        expect(overview.map(row => [row.agentId, row.latest?.id ?? null, row.pending, row.generalSessionId])).toEqual([
            [SCOUT, THREAD, 1, GENERAL],
            [LEDGER, null, 0, null],
        ])
        expect(overview[0].latest?.lastMessage).toEqual({ text: 'Should I include the bakeries of Villeurbanne?', mine: false })
    })

    describe('its sheet', () => {
        it('reads it with the model it runs on, for a build that knows the provider', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/route')
            const view = (await expectContract(mobileApi.getAgent, await callRoute(GET, mobileApi.getAgent, { params: { id: SCOUT }, client: CURRENT_IOS }))) as z.infer<typeof agentViewSchema>
            expect(view.agent).toMatchObject({ id: SCOUT, access: 'manage', disabledAt: null })
            expect(view.detail?.config).toMatchObject({ provider: 'opencode', model: 'go/glm-5.3' })
        })

        it('leaves out a provider an older iOS build does not know, so that build still reads it', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/route')
            const res = await callRoute(GET, mobileApi.getAgent, { params: { id: SCOUT }, client: OLD_IOS })
            const shipped = shippedIosAgentViewSchema.parse(await res.clone().json())
            await expectContract(mobileApi.getAgent, res)
            expect(shipped.detail).toMatchObject({ config: { provider: null, model: null, connectionId: 'cnx-oc' }, resolvedProvider: null, resolvedModel: null })
        })

        it('reads a switched-off coworker without asking its engine', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/route')
            const view = (await expectContract(mobileApi.getAgent, await callRoute(GET, mobileApi.getAgent, { params: { id: LEDGER } }))) as z.infer<typeof agentViewSchema>
            expect(view).toMatchObject({ agent: { id: LEDGER, disabledReason: 'plan_limit' }, detail: null, locked: false })
            expect(engine.getAgent).not.toHaveBeenCalled()
        })

        it('answers a coworker of another workspace as missing', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/route')
            const res = await callRoute(GET, mobileApi.getAgent, { params: { id: STRANGER } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.getAgent, res, 404)
        })

        it('renames it on its engine and in the database', async () => {
            const { PATCH } = await import('@/app/api/v1/agents/[id]/route')
            expect(await expectContract(mobileApi.renameAgent, await callRoute(PATCH, mobileApi.renameAgent, { params: { id: SCOUT }, body: { name: 'Scout Lyon' } }))).toBeUndefined()
            expect(engine.patchAgent).toHaveBeenCalledWith(expect.anything(), 'scout', { name: 'scout_lyon', displayName: 'Scout Lyon' })
            expect(state.db?.writes('agents')).toEqual([expect.objectContaining({ method: 'update', payload: { name: 'Scout Lyon', handle: 'scout_lyon' } })])
        })

        it('refuses the rename to a member who only uses its Box', async () => {
            state.ctx = contractContext(state.db as FakeSupabase, { role: 'member', boxScope: 'all' })
            const { PATCH } = await import('@/app/api/v1/agents/[id]/route')
            const res = await callRoute(PATCH, mobileApi.renameAgent, { params: { id: SCOUT }, body: { name: 'Scout Lyon' } })
            expect(res.status).toBe(403)
            await expectContract(mobileApi.renameAgent, res, 403)
            expect(engine.patchAgent).not.toHaveBeenCalled()
        })

        it('deletes it from its engine and from the database', async () => {
            const { DELETE } = await import('@/app/api/v1/agents/[id]/route')
            expect(await expectContract(mobileApi.deleteAgent, await callRoute(DELETE, mobileApi.deleteAgent, { params: { id: SCOUT } }))).toBeUndefined()
            expect(engine.deleteAgent).toHaveBeenCalledWith(expect.anything(), 'scout')
            expect(state.db?.writes('agents').map(write => write.method)).toEqual(['delete'])
        })
    })

    describe('its model', () => {
        it('offers every connection of the machine to a build that knows them', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/models/route')
            const models = (await expectContract(mobileApi.getAgentModels, await callRoute(GET, mobileApi.getAgentModels, { params: { id: SCOUT }, client: CURRENT_IOS }))) as z.infer<typeof agentModelsSchema>
            expect(models.groups.map(group => [group.connectionId, group.provider])).toEqual([
                ['rerun', 'rerun'],
                ['cnx-oc', 'opencode'],
            ])
            expect(models).toMatchObject({ pinned: { connectionId: 'cnx-oc', model: 'go/glm-5.3' }, resolved: { connectionId: 'cnx-oc', model: 'go/glm-5.3' }, boxDefault: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' } })
        })

        it('leaves out a provider an older iOS build does not know, so that build still reads the picker', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/models/route')
            const res = await callRoute(GET, mobileApi.getAgentModels, { params: { id: SCOUT }, client: OLD_IOS })
            const shipped = shippedIosAgentModelsSchema.parse(await res.clone().json())
            await expectContract(mobileApi.getAgentModels, res)
            expect(shipped.groups.map(group => group.connectionId)).toEqual(['rerun'])
        })

        it('pins a model of a connection of the machine', async () => {
            const { PUT } = await import('@/app/api/v1/agents/[id]/model/route')
            expect(await expectContract(mobileApi.setAgentModel, await callRoute(PUT, mobileApi.setAgentModel, { params: { id: SCOUT }, body: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' } }))).toBeUndefined()
            expect(engine.patchAgent).toHaveBeenCalledWith(expect.anything(), 'scout', { connectionId: 'cnx-oc', provider: 'opencode', model: 'go/deepseek-v4-pro' })
        })

        it('puts it back on the machine default', async () => {
            const { PUT } = await import('@/app/api/v1/agents/[id]/model/route')
            expect(await expectContract(mobileApi.setAgentModel, await callRoute(PUT, mobileApi.setAgentModel, { params: { id: SCOUT }, body: { connectionId: null, model: null } }))).toBeUndefined()
            expect(engine.patchAgent).toHaveBeenCalledWith(expect.anything(), 'scout', { connectionId: null, provider: null, model: null })
        })

        it('refuses a connection the machine does not have', async () => {
            const { PUT } = await import('@/app/api/v1/agents/[id]/model/route')
            const res = await callRoute(PUT, mobileApi.setAgentModel, { params: { id: SCOUT }, body: { connectionId: 'cnx-gone', model: 'gpt-5' } })
            expect(res.status).toBe(400)
            await expectContract(mobileApi.setAgentModel, res, 400)
        })
    })

    describe('its keys and what it may spend', () => {
        it('lists the names of its keys, never their values', async () => {
            engine.getAgentKeys.mockResolvedValue({ keys: ['PIPEDRIVE_API_TOKEN'], engineKeys: ['RERUN_API_KEY'] })
            const { GET } = await import('@/app/api/v1/agents/[id]/keys/route')
            expect(await expectContract(mobileApi.getAgentKeys, await callRoute(GET, mobileApi.getAgentKeys, { params: { id: SCOUT } }))).toEqual({ keys: ['PIPEDRIVE_API_TOKEN'], engineKeys: ['RERUN_API_KEY'] })
        })

        it('writes and removes keys, and answers the names left', async () => {
            engine.updateAgentKeys.mockResolvedValue(['SIRENE_API_KEY'])
            const { PUT } = await import('@/app/api/v1/agents/[id]/keys/route')
            const res = await callRoute(PUT, mobileApi.updateAgentKeys, { params: { id: SCOUT }, body: { set: { SIRENE_API_KEY: 'sir_live_4f9a' }, remove: ['PIPEDRIVE_API_TOKEN'] } })
            expect(await expectContract(mobileApi.updateAgentKeys, res)).toEqual({ keys: ['SIRENE_API_KEY'] })
            expect(engine.updateAgentKeys).toHaveBeenCalledWith(expect.anything(), 'scout', { set: { SIRENE_API_KEY: 'sir_live_4f9a' }, remove: ['PIPEDRIVE_API_TOKEN'] })
        })

        it('lets it spend on paid data without asking again', async () => {
            const { PUT } = await import('@/app/api/v1/agents/[id]/paid-data/route')
            expect(await expectContract(mobileApi.setPaidDataAlwaysAllow, await callRoute(PUT, mobileApi.setPaidDataAlwaysAllow, { params: { id: SCOUT }, body: { alwaysAllow: true } }))).toBeUndefined()
            expect(engine.patchAgent).toHaveBeenCalledWith(expect.anything(), 'scout', { paidDataAlwaysAllow: true })
        })
    })

    it('lists its conversations, one another coworker opened on it included', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/conversations/route')
        const conversations = (await expectContract(mobileApi.listAgentConversations, await callRoute(GET, mobileApi.listAgentConversations, { params: { id: SCOUT } }))) as { id: string | null; unseen?: boolean; ask?: string | null; originAgentName: string | null }[]
        expect(conversations.map(c => ({ id: c.id, unseen: c.unseen, ask: c.ask, originAgentName: c.originAgentName }))).toEqual([
            { id: THREAD, unseen: false, ask: 'Should I include the bakeries of Villeurbanne?', originAgentName: null },
            { id: GENERAL, unseen: true, ask: null, originAgentName: null },
            { id: null, unseen: false, ask: null, originAgentName: 'Ledger' },
        ])
    })

    it('lists its files, newest first, without the hidden folders nor the dependencies', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/files/route')
        expect(await expectContract(mobileApi.listAgentFiles, await callRoute(GET, mobileApi.listAgentFiles, { params: { id: SCOUT } }))).toEqual({
            files: [
                { path: 'leads/lyon.csv', name: 'lyon.csv', size: 1_204, modifiedAt: '2026-11-18T09:20:00.000Z', kind: 'doc' },
                { path: 'report.pdf', name: 'report.pdf', size: 48_213, modifiedAt: '2026-11-17T18:00:00.000Z', kind: 'doc' },
                { path: 'leads/storefront.jpg', name: 'storefront.jpg', size: 310_552, modifiedAt: '2026-11-16T12:00:00.000Z', kind: 'media' },
            ],
            truncated: false,
        })
    })

    it('lists the apps it has, named from the catalog', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/services/route')
        expect(await expectContract(mobileApi.listAgentServices, await callRoute(GET, mobileApi.listAgentServices, { params: { id: SCOUT } }))).toEqual([
            { key: 'hubspot', slug: 'hubspot', name: 'HubSpot', icon: 'https://cdn.rerun.build/services/hubspot.svg', category: 'crm', status: 'active', toolNames: ['hubspot'], authMethodId: 'oauth', installedAt: '2026-11-06T11:00:00.000Z' },
        ])
    })

    it('lists its skills', async () => {
        engine.listSkillSummaries.mockResolvedValue([{ slug: 'qualify-lead', name: 'Qualify a lead', description: 'Scores a bakery on its website and its reviews' }])
        const { GET } = await import('@/app/api/v1/agents/[id]/skills/route')
        expect(await expectContract(mobileApi.listAgentSkills, await callRoute(GET, mobileApi.listAgentSkills, { params: { id: SCOUT } }))).toEqual({ skills: [{ slug: 'qualify-lead', name: 'Qualify a lead', description: 'Scores a bakery on its website and its reviews' }] })
    })

    describe('its routines', () => {
        it('lists its scheduled tasks and its triggers as one list, the cron put in words', async () => {
            const { GET } = await import('@/app/api/v1/agents/[id]/routines/route')
            const { routines } = (await expectContract(mobileApi.listAgentRoutines, await callRoute(GET, mobileApi.listAgentRoutines, { params: { id: SCOUT } }))) as { routines: { kind: string; slug: string; enabled: boolean; cronLabel: string | null }[] }
            expect(routines.map(routine => [routine.kind, routine.slug, routine.enabled])).toEqual([
                ['schedule', 'weekly-leads', true],
                ['trigger', 'new-lead', false],
            ])
            expect(routines[0].cronLabel).toMatch(/Monday/)
        })

        it('switches a scheduled task off', async () => {
            const { PATCH } = await import('@/app/api/v1/agents/[id]/routines/[kind]/[slug]/route')
            expect(await expectContract(mobileApi.setAgentRoutineEnabled, await callRoute(PATCH, mobileApi.setAgentRoutineEnabled, { params: { id: SCOUT, kind: 'schedule', slug: 'weekly-leads' }, body: { enabled: false } }))).toBeUndefined()
            expect(engine.updateSchedule).toHaveBeenCalledWith(expect.anything(), 'scout', 'weekly-leads', { enabled: false })
        })

        it('switches a trigger on', async () => {
            const { PATCH } = await import('@/app/api/v1/agents/[id]/routines/[kind]/[slug]/route')
            expect(await expectContract(mobileApi.setAgentRoutineEnabled, await callRoute(PATCH, mobileApi.setAgentRoutineEnabled, { params: { id: SCOUT, kind: 'trigger', slug: 'new-lead' }, body: { enabled: true } }))).toBeUndefined()
            expect(engine.updateTrigger).toHaveBeenCalledWith(expect.anything(), 'scout', 'new-lead', { enabled: true })
        })

        it('answers a routine of an unknown kind as missing', async () => {
            const { PATCH } = await import('@/app/api/v1/agents/[id]/routines/[kind]/[slug]/route')
            const res = await callRoute(PATCH, mobileApi.setAgentRoutineEnabled, { params: { id: SCOUT, kind: 'cron', slug: 'weekly-leads' }, body: { enabled: false } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.setAgentRoutineEnabled, res, 404)
        })
    })

    describe('a delegated task', () => {
        it('stops one task of a run', async () => {
            const { POST } = await import('@/app/api/v1/agents/[id]/runs/[runId]/tasks/[taskId]/cancel/route')
            expect(await expectContract(mobileApi.cancelSubRun, await callRoute(POST, mobileApi.cancelSubRun, { params: { id: SCOUT, runId: 'run_01JD8Z', taskId: 'task-2' } }))).toBeUndefined()
            expect(engine.cancelSubRun).toHaveBeenCalledWith(expect.anything(), 'scout', 'run_01JD8Z', 'task-2')
        })

        it('says so when the engine could not stop it', async () => {
            engine.cancelSubRun.mockRejectedValue(new Error('engine answered 409'))
            const { POST } = await import('@/app/api/v1/agents/[id]/runs/[runId]/tasks/[taskId]/cancel/route')
            const res = await callRoute(POST, mobileApi.cancelSubRun, { params: { id: SCOUT, runId: 'run_01JD8Z', taskId: 'task-2' } })
            expect(res.status).toBe(503)
            await expectContract(mobileApi.cancelSubRun, res, 503)
        })
    })

    describe('its screen', () => {
        it('opens the socket to watch it, through the relay of its host', async () => {
            const { POST } = await import('@/app/api/v1/agents/[id]/desktop/route')
            const socket = (await expectContract(mobileApi.openDesktop, await callRoute(POST, mobileApi.openDesktop, { params: { id: SCOUT }, body: { mode: 'watch', timeZone: 'Europe/Paris' } }))) as { socketUrl: string; dock: boolean }
            expect(socket.dock).toBe(true)
            expect(socket.socketUrl).toMatch(/^wss:\/\/relay-01\.rerun\.build\/box\/3\/desktop\/ws\?ticket=/)
            expect(engine.startDesktop).toHaveBeenCalledWith(expect.anything(), 'scout', 'Europe/Paris')
        })

        it('says so when the machine has no screen yet', async () => {
            engine.supportsDesktop.mockResolvedValue(false)
            const { POST } = await import('@/app/api/v1/agents/[id]/desktop/route')
            const res = await callRoute(POST, mobileApi.openDesktop, { params: { id: SCOUT }, body: { mode: 'drive' } })
            expect(res.status).toBe(503)
            await expectContract(mobileApi.openDesktop, res, 503)
        })

        it('opens its browser for the person to drive', async () => {
            const { POST } = await import('@/app/api/v1/agents/[id]/desktop/takeover/route')
            expect(await expectContract(mobileApi.startTakeover, await callRoute(POST, mobileApi.startTakeover, { params: { id: SCOUT }, body: { url: 'https://www.google.com/maps/search/boulangerie+lyon' } }))).toBeUndefined()
            expect(engine.startTakeover).toHaveBeenCalledWith(expect.anything(), 'scout', 'https://www.google.com/maps/search/boulangerie+lyon')
        })

        it('hands the browser back with the page it was left on', async () => {
            engine.finishTakeover.mockResolvedValue({ url: 'https://www.google.com/maps/place/Boulangerie+Saint-Paul', open: true })
            const { DELETE } = await import('@/app/api/v1/agents/[id]/desktop/takeover/route')
            const res = await callRoute(DELETE, mobileApi.finishTakeover, { params: { id: SCOUT }, query: { keepOpen: '1' } })
            expect(await expectContract(mobileApi.finishTakeover, res)).toEqual({ url: 'https://www.google.com/maps/place/Boulangerie+Saint-Paul', open: true })
            expect(engine.finishTakeover).toHaveBeenCalledWith(expect.anything(), 'scout', { keepOpen: true })
        })
    })
})
