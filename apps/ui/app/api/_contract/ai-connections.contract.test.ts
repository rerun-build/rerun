import { aiConnectionsViewSchema, mobileApi, RERUN_MODELS, OPENCODE_DEFAULT_MODEL, type HubEndpoint } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { CLAUDE_OAUTH } from '@/lib/engine/claude-oauth'
import { CODEX_OAUTH } from '@/lib/engine/codex-oauth'
import { forgetMachine } from '@/lib/engine/engine-memory'
import { mintClaudeSignIn, mintCodexSignIn } from '@/lib/engine/sign-in-ticket'
import type { BoxConnection, CreateBoxConnectionInput } from '@/lib/engine/types'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { shippedIosConnectionsViewSchema } from '@/test/shipped-ios'
import { fakeSupabase, tableResolver, type FakeSupabase } from '@/test/supabase-fake'

type Rows<T extends keyof Database['public']['Tables']> = Partial<Database['public']['Tables'][T]['Row']>[]
type EngineClient = typeof import('@/lib/engine/client')

// The AI providers screen of the app. The services run for real on a fake database; the machine is
// replaced at its HTTP client, and Anthropic and OpenAI at their sign-in endpoints.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null }))
const engine = vi.hoisted(() => ({
    listConnections: vi.fn<EngineClient['listConnections']>(),
    supportsOpencode: vi.fn<EngineClient['supportsOpencode']>(),
    supportsCustomProvider: vi.fn<EngineClient['supportsCustomProvider']>(),
    createConnection: vi.fn<EngineClient['createConnection']>(),
    patchConnection: vi.fn<EngineClient['patchConnection']>(),
    updateConnectionKeys: vi.fn<EngineClient['updateConnectionKeys']>(),
    setBoxDefault: vi.fn<EngineClient['setBoxDefault']>(),
    getConnectionUsage: vi.fn<EngineClient['getConnectionUsage']>(),
    deleteConnection: vi.fn<EngineClient['deleteConnection']>(),
}))
const providerKeyProblem = vi.hoisted(() => vi.fn<typeof import('@/lib/engine/verify-provider-key').providerKeyProblem>())

vi.mock('@/app/api/_auth/ownership', async importOriginal => {
    const actual = await importOriginal<typeof import('@/app/api/_auth/ownership')>()
    return {
        ...actual,
        requireWorkspaceContext: async () => state.ctx,
        requireAdminContext: async () => {
            if (state.ctx?.role !== 'admin') throw new actual.AuthorizationError(actual.ADMIN_ONLY)
            return state.ctx
        },
    }
})
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ ...state.db?.client, auth: { getUser: async () => ({ data: { user: state.ctx?.authUser } }) } }),
    getRequestAccessToken: async () => 'token',
}))
// Rerun Cloud's plans, whatever the build resolves @rerun/cloud/billing to: a self-hosted install has
// no plan to lack, so the no_plan refusal only exists there.
vi.mock('@rerun/cloud/billing', async () => ({
    ...(await vi.importActual<typeof import('@/ee/lib/billing/entitlement')>('@/ee/lib/billing/entitlement')),
    ...(await vi.importActual<typeof import('@/ee/lib/billing/plans')>('@/ee/lib/billing/plans')),
    BILLING_ENABLED: true,
}))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<EngineClient>()), ...engine }))
vi.mock('@/lib/engine/verify-provider-key', () => ({ providerKeyProblem }))

function boxConnection(fields: Pick<BoxConnection, 'id' | 'name' | 'provider' | 'models'> & Partial<BoxConnection>): BoxConnection {
    return { extraModels: [], createdAt: '2026-11-02T09:00:00.000Z', connected: true, credentialRejected: false, planLimits: null, cliModels: null, providerModels: null, discoveredModels: null, ...fields }
}

const rerun = boxConnection({ id: 'rerun', name: 'Rerun', provider: 'rerun', models: [RERUN_MODELS.balanced] })
const claude = boxConnection({
    id: 'cnx-claude',
    name: 'Claude',
    provider: 'claude',
    models: ['claude-opus-5-5', 'claude-sonnet-4-6'],
    planLimits: { windows: [{ kind: 'weekly', label: null, usedPercent: 42, resetsAt: '2026-11-24T08:00:00.000Z' }], capturedAt: '2026-11-19T08:00:00.000Z' },
})
const opencode = boxConnection({ id: 'cnx-oc', name: 'OpenCode', provider: 'opencode', models: [OPENCODE_DEFAULT_MODEL] })
const custom = boxConnection({ id: 'cnx-custom', name: 'Ollama', provider: 'custom', models: ['qwen3:4b'], baseUrl: 'https://llm.atelier-nord.fr/v1', discoveredModels: [{ id: 'qwen3:4b', contextWindow: 32768 }] })

const enginePool: Rows<'engine_pool'> = [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }]
const workspace: Rows<'workspaces'>[number] = { id: 7, name: 'Atelier Nord', plan: 'pro', subscription_status: 'active', boxes_archived_at: null }

function openDatabase(overrides: { engine_pool?: Rows<'engine_pool'>; workspaces?: Rows<'workspaces'> } = {}, ctx: Partial<WorkspaceContext> = {}) {
    forgetMachine(7)
    const db = fakeSupabase(tableResolver({ engine_pool: enginePool, workspaces: [workspace], users: [], ...overrides }))
    state.db = db
    state.ctx = contractContext(db, ctx)
}

// A workspace whose subscription ended: no machine yet, and none to claim.
const withoutPlan = () => openDatabase({ engine_pool: [], workspaces: [{ ...workspace, subscription_status: 'canceled' }] })

const asMember = () => openDatabase({}, { role: 'member', boxScope: 'assigned' })

function providerEndpoints(answers: Record<string, () => Response>) {
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async input => {
            const url = input instanceof Request ? input.url : String(input)
            const answer = answers[url]
            if (!answer) throw new Error(`Unexpected request to ${url}`)
            return answer()
        })
    )
}

const claudeToken = () => Response.json({ access_token: 'sk-ant-oat01-access', refresh_token: 'sk-ant-ort01-refresh', expires_in: 28_800 })
const codexApproved = { [CODEX_OAUTH.devicePollUrl]: () => Response.json({ authorization_code: 'ac_01', code_verifier: 'cv_01' }), [CODEX_OAUTH.tokenUrl]: () => Response.json({ access_token: 'codex-access', refresh_token: 'codex-refresh', id_token: '' }) }

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'contract-secret')
    vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
    vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '50')
    openDatabase()
    engine.listConnections.mockResolvedValue({ connections: [claude, opencode, custom, rerun], default: { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' }, backups: { backups: [], rerunCreditLastResort: false } })
    engine.supportsOpencode.mockResolvedValue(true)
    engine.supportsCustomProvider.mockResolvedValue(true)
    engine.createConnection.mockImplementation(async (_conn, params: CreateBoxConnectionInput) => boxConnection({ id: `cnx-${params.provider}-2`, name: params.name, provider: params.provider, models: params.models }))
    engine.patchConnection.mockImplementation(async (_conn, id, patch) => ({ ...claude, id, ...patch }))
    engine.updateConnectionKeys.mockResolvedValue(['CLAUDE_CODE_OAUTH_TOKEN'])
    engine.setBoxDefault.mockResolvedValue(undefined)
    engine.getConnectionUsage.mockResolvedValue({ agents: [{ id: 'agent-scout', name: 'Scout' }], automations: [{ agentId: 'agent-scout', kind: 'schedule', slug: 'monday-leads' }], isBoxDefault: true })
    engine.deleteConnection.mockResolvedValue({ agents: [{ id: 'agent-scout', name: 'Scout' }], automations: [], isBoxDefault: false })
    providerKeyProblem.mockResolvedValue(null)
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('the AI providers of the mobile app', () => {
    it('lists every provider of the machine to a build that knows them all', async () => {
        const { GET } = await import('@/app/api/v1/ai-connections/route')
        const view = (await expectContract(mobileApi.listAiConnections, await callRoute(GET, mobileApi.listAiConnections, { client: 'ios/1.5.0 (50)' }))) as z.infer<typeof aiConnectionsViewSchema>
        expect(view.connections.map(connection => connection.id)).toEqual(['rerun', 'cnx-claude', 'cnx-oc', 'cnx-custom'])
        expect(view.connections.find(connection => connection.id === 'cnx-claude')).toMatchObject({ kind: 'plan', status: 'connected', isDefault: true })
        expect(view.default).toMatchObject({ connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' })
        expect(view.addable.map(entry => entry.provider)).toEqual(['claude', 'codex', 'opencode', 'anthropic', 'openai', 'google', 'openrouter', 'custom'])
    })

    // An iOS build from before OpenCode and custom endpoints parses the provider strictly: one it does
    // not know anywhere in the answer fails the whole screen.
    it('keeps the providers an old iOS build does not know out of its answer', async () => {
        const { GET } = await import('@/app/api/v1/ai-connections/route')
        const view = shippedIosConnectionsViewSchema.parse(await expectContract(mobileApi.listAiConnections, await callRoute(GET, mobileApi.listAiConnections, { client: 'ios/1.0.1 (30)' })))
        expect(view.connections.map(connection => connection.id)).toEqual(['rerun', 'cnx-claude'])
        expect(view.addable.map(entry => entry.provider)).toEqual(['claude', 'codex', 'anthropic', 'openai', 'google', 'openrouter'])
    })

    it('adds a provider from an API key, under a name not taken yet', async () => {
        const { POST } = await import('@/app/api/v1/ai-connections/route')
        const res = await callRoute(POST, mobileApi.createAiConnection, { body: { provider: 'anthropic', apiKey: 'sk-ant-api03-key' } })
        expect(await expectContract(mobileApi.createAiConnection, res)).toEqual({ connectionId: 'cnx-anthropic-2' })
        expect(engine.createConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Anthropic', provider: 'anthropic', keys: { ANTHROPIC_API_KEY: 'sk-ant-api03-key' } }))
    })

    it('refuses to add a provider to a workspace without a plan, with its reason', async () => {
        withoutPlan()
        const { POST } = await import('@/app/api/v1/ai-connections/route')
        const res = await callRoute(POST, mobileApi.createAiConnection, { body: { provider: 'openai', apiKey: 'sk-proj-key' } })
        expect(res.status).toBe(403)
        expect(await expectContract(mobileApi.createAiConnection, res, 403)).toMatchObject({ reason: 'no_plan' })
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('renames a provider', async () => {
        const { PATCH } = await import('@/app/api/v1/ai-connections/[id]/route')
        const res = await callRoute(PATCH, mobileApi.updateAiConnection, { params: { id: 'cnx-claude' }, body: { name: 'Claude Max' } })
        await expectContract(mobileApi.updateAiConnection, res)
        expect(engine.patchConnection).toHaveBeenCalledWith(expect.anything(), 'cnx-claude', { name: 'Claude Max' })
    })

    it('reads a provider the machine no longer lists as missing', async () => {
        const { PATCH } = await import('@/app/api/v1/ai-connections/[id]/route')
        const res = await callRoute(PATCH, mobileApi.updateAiConnection, { params: { id: 'cnx-gone' }, body: { name: 'Gone' } })
        expect(res.status).toBe(404)
        await expectContract(mobileApi.updateAiConnection, res, 404)
        expect(engine.patchConnection).not.toHaveBeenCalled()
    })

    it('removes a provider, and refuses to remove Rerun', async () => {
        const { DELETE } = await import('@/app/api/v1/ai-connections/[id]/route')
        await expectContract(mobileApi.deleteAiConnection, await callRoute(DELETE, mobileApi.deleteAiConnection, { params: { id: 'cnx-claude' } }))
        expect(engine.deleteConnection).toHaveBeenCalledWith(expect.anything(), 'cnx-claude')

        const refused = await callRoute(DELETE, mobileApi.deleteAiConnection, { params: { id: 'rerun' } })
        expect(refused.status).toBe(400)
        await expectContract(mobileApi.deleteAiConnection, refused, 400)
    })

    it('replaces the key of a provider and drops the refresh material of the old one', async () => {
        const { PUT } = await import('@/app/api/v1/ai-connections/[id]/keys/route')
        await expectContract(mobileApi.replaceAiConnectionKey, await callRoute(PUT, mobileApi.replaceAiConnectionKey, { params: { id: 'cnx-claude' }, body: { apiKey: 'sk-ant-oat01-new' } }))
        expect(engine.updateConnectionKeys).toHaveBeenCalledWith(expect.anything(), 'cnx-claude', { set: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-new' }, remove: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_EXPIRES_AT'] })
    })

    it('says what still runs on a provider', async () => {
        const { GET } = await import('@/app/api/v1/ai-connections/[id]/usage/route')
        const usage = await expectContract(mobileApi.getAiConnectionUsage, await callRoute(GET, mobileApi.getAiConnectionUsage, { params: { id: 'cnx-claude' } }))
        expect(usage).toEqual({ agents: [{ id: 'agent-scout', name: 'Scout' }], automations: [{ agentId: 'agent-scout', kind: 'schedule', slug: 'monday-leads' }], isBoxDefault: true })
    })

    it('sets the model of the workspace, and puts it back on Rerun', async () => {
        const { PUT } = await import('@/app/api/v1/ai-connections/default/route')
        await expectContract(mobileApi.setWorkspaceDefaultModel, await callRoute(PUT, mobileApi.setWorkspaceDefaultModel, { body: { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' } }))
        expect(engine.setBoxDefault).toHaveBeenLastCalledWith(expect.anything(), { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' })
        await expectContract(mobileApi.setWorkspaceDefaultModel, await callRoute(PUT, mobileApi.setWorkspaceDefaultModel, { body: { connectionId: null, model: null } }))
        expect(engine.setBoxDefault).toHaveBeenLastCalledWith(expect.anything(), null)
    })
})

describe('the subscription sign-ins of the mobile app', () => {
    it('starts a Claude sign-in with the PKCE pair sealed in the ticket', async () => {
        const { POST } = await import('@/app/api/v1/ai-connections/claude/start/route')
        const start = (await expectContract(mobileApi.startClaudeSignIn, await callRoute(POST, mobileApi.startClaudeSignIn))) as { authorizeUrl: string; ticket: string }
        expect(start.authorizeUrl.startsWith(CLAUDE_OAUTH.authorizeUrl)).toBe(true)
        expect(start.ticket).not.toContain(new URL(start.authorizeUrl).searchParams.get('state'))
    })

    it('finishes a Claude sign-in with the code Claude shows, and stores the tokens on the machine', async () => {
        const start = await import('@/app/api/v1/ai-connections/claude/start/route')
        const finish = await import('@/app/api/v1/ai-connections/claude/finish/route')
        const { authorizeUrl, ticket } = (await expectContract(mobileApi.startClaudeSignIn, await callRoute(start.POST, mobileApi.startClaudeSignIn))) as { authorizeUrl: string; ticket: string }
        providerEndpoints({ [CLAUDE_OAUTH.tokenUrl]: claudeToken })
        const code = `auth-code#${new URL(authorizeUrl).searchParams.get('state')}`
        expect(await expectContract(mobileApi.finishClaudeSignIn, await callRoute(finish.POST, mobileApi.finishClaudeSignIn, { body: { code, ticket } }))).toEqual({ connectionId: 'cnx-claude-2' })
        expect(engine.createConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Claude 2', provider: 'claude', keys: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-access', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'sk-ant-ort01-refresh' }) }))
    })

    it('refuses to store a Claude sign-in on a workspace without a plan, with its reason', async () => {
        withoutPlan()
        providerEndpoints({ [CLAUDE_OAUTH.tokenUrl]: claudeToken })
        const { POST } = await import('@/app/api/v1/ai-connections/claude/finish/route')
        const res = await callRoute(POST, mobileApi.finishClaudeSignIn, { body: { code: 'auth-code#s', ticket: mintClaudeSignIn('user-ada', { verifier: 'v', state: 's' }) } })
        expect(res.status).toBe(403)
        expect(await expectContract(mobileApi.finishClaudeSignIn, res, 403)).toMatchObject({ reason: 'no_plan' })
    })

    it('starts a Codex sign-in with the device auth id sealed in the ticket', async () => {
        providerEndpoints({ [CODEX_OAUTH.deviceCodeUrl]: () => Response.json({ device_auth_id: 'deviceauth_01', user_code: 'K7QX-M2PL', interval: '5', expires_at: '2026-11-19T10:15:00.000Z' }) })
        const { POST } = await import('@/app/api/v1/ai-connections/codex/start/route')
        const start = await expectContract(mobileApi.startCodexSignIn, await callRoute(POST, mobileApi.startCodexSignIn))
        expect(start).toEqual({ ticket: expect.any(String), userCode: 'K7QX-M2PL', verificationUrl: CODEX_OAUTH.verificationUrl, pollIntervalMs: 5000, expiresAt: Date.parse('2026-11-19T10:15:00.000Z') })
        expect(JSON.stringify(start)).not.toContain('deviceauth_01')
    })

    it('answers pending until OpenAI approves, then stores the Codex tokens', async () => {
        const { POST } = await import('@/app/api/v1/ai-connections/codex/poll/route')
        const ticket = mintCodexSignIn('user-ada', { deviceAuthId: 'deviceauth_01', userCode: 'K7QX-M2PL' })
        providerEndpoints({ [CODEX_OAUTH.devicePollUrl]: () => Response.json({ error: { code: 'deviceauth_authorization_pending' } }, { status: 403 }) })
        expect(await expectContract(mobileApi.pollCodexSignIn, await callRoute(POST, mobileApi.pollCodexSignIn, { body: { ticket } }))).toEqual({ status: 'pending' })

        providerEndpoints(codexApproved)
        expect(await expectContract(mobileApi.pollCodexSignIn, await callRoute(POST, mobileApi.pollCodexSignIn, { body: { ticket } }))).toEqual({ status: 'connected', connectionId: 'cnx-codex-2' })
        expect(engine.createConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'ChatGPT', provider: 'codex', keys: expect.objectContaining({ CODEX_OAUTH_TOKEN: 'codex-access', CODEX_OAUTH_REFRESH_TOKEN: 'codex-refresh' }) }))
    })

    it('polls nothing for a sign-in another person started', async () => {
        const { POST } = await import('@/app/api/v1/ai-connections/codex/poll/route')
        providerEndpoints(codexApproved)
        const res = await callRoute(POST, mobileApi.pollCodexSignIn, { body: { ticket: mintCodexSignIn('user-grace', { deviceAuthId: 'deviceauth_01', userCode: 'K7QX-M2PL' }) } })
        expect(res.status).toBe(400)
        expect(await expectContract(mobileApi.pollCodexSignIn, res, 400)).toEqual({ error: 'This sign-in was started from another account. Start it again.' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('refuses to store a Codex sign-in on a workspace without a plan, with its reason', async () => {
        withoutPlan()
        providerEndpoints(codexApproved)
        const { POST } = await import('@/app/api/v1/ai-connections/codex/poll/route')
        const res = await callRoute(POST, mobileApi.pollCodexSignIn, { body: { ticket: mintCodexSignIn('user-ada', { deviceAuthId: 'deviceauth_01', userCode: 'K7QX-M2PL' }) } })
        expect(res.status).toBe(403)
        expect(await expectContract(mobileApi.pollCodexSignIn, res, 403)).toMatchObject({ reason: 'no_plan' })
    })
})

// Every write on the providers is the admin's: a member reads the list and the usage, and gets the
// 403 the app reads with the same schema as a missing plan.
describe('a member who does not run the workspace', () => {
    type Call = [string, HubEndpoint, () => Promise<Response>]
    const calls: Call[] = [
        ['createAiConnection', mobileApi.createAiConnection, async () => callRoute((await import('@/app/api/v1/ai-connections/route')).POST, mobileApi.createAiConnection, { body: { provider: 'openai', apiKey: 'sk-proj-key' } })],
        ['updateAiConnection', mobileApi.updateAiConnection, async () => callRoute((await import('@/app/api/v1/ai-connections/[id]/route')).PATCH, mobileApi.updateAiConnection, { params: { id: 'cnx-claude' }, body: { name: 'Mine' } })],
        ['deleteAiConnection', mobileApi.deleteAiConnection, async () => callRoute((await import('@/app/api/v1/ai-connections/[id]/route')).DELETE, mobileApi.deleteAiConnection, { params: { id: 'cnx-claude' } })],
        ['replaceAiConnectionKey', mobileApi.replaceAiConnectionKey, async () => callRoute((await import('@/app/api/v1/ai-connections/[id]/keys/route')).PUT, mobileApi.replaceAiConnectionKey, { params: { id: 'cnx-claude' }, body: { apiKey: 'sk-ant-oat01-new' } })],
        ['setWorkspaceDefaultModel', mobileApi.setWorkspaceDefaultModel, async () => callRoute((await import('@/app/api/v1/ai-connections/default/route')).PUT, mobileApi.setWorkspaceDefaultModel, { body: { connectionId: null, model: null } })],
        ['startClaudeSignIn', mobileApi.startClaudeSignIn, async () => callRoute((await import('@/app/api/v1/ai-connections/claude/start/route')).POST, mobileApi.startClaudeSignIn)],
        ['finishClaudeSignIn', mobileApi.finishClaudeSignIn, async () => callRoute((await import('@/app/api/v1/ai-connections/claude/finish/route')).POST, mobileApi.finishClaudeSignIn, { body: { code: 'auth-code#s', ticket: mintClaudeSignIn('user-ada', { verifier: 'v', state: 's' }) } })],
        ['pollCodexSignIn', mobileApi.pollCodexSignIn, async () => callRoute((await import('@/app/api/v1/ai-connections/codex/poll/route')).POST, mobileApi.pollCodexSignIn, { body: { ticket: mintCodexSignIn('user-ada', { deviceAuthId: 'deviceauth_01', userCode: 'K7QX-M2PL' }) } })],
    ]

    it.each(calls)('gets a 403 the app reads from %s', async (_name, endpoint, call) => {
        asMember()
        const res = await call()
        expect(res.status).toBe(403)
        await expectContract(endpoint, res, 403)
        expect(engine.createConnection).not.toHaveBeenCalled()
        expect(engine.patchConnection).not.toHaveBeenCalled()
        expect(engine.deleteConnection).not.toHaveBeenCalled()
        expect(engine.updateConnectionKeys).not.toHaveBeenCalled()
        expect(engine.setBoxDefault).not.toHaveBeenCalled()
    })

    it('still reads the providers and what runs on them', async () => {
        asMember()
        const list = await import('@/app/api/v1/ai-connections/route')
        const usage = await import('@/app/api/v1/ai-connections/[id]/usage/route')
        expect((await callRoute(list.GET, mobileApi.listAiConnections)).status).toBe(200)
        expect((await callRoute(usage.GET, mobileApi.getAiConnectionUsage, { params: { id: 'cnx-claude' } })).status).toBe(200)
    })
})
