import { aiConnectionsViewSchema, mobileApi, RERUN_MODELS, OPENCODE_DEFAULT_MODEL, type HubEndpoint } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { CLAUDE_OAUTH } from '@/lib/engine/claude-oauth'
import { CODEX_OAUTH } from '@/lib/engine/codex-oauth'
import { forgetMachine } from '@/lib/engine/engine-memory'
import { mintClaudeSignIn, mintCodexSignIn, mintGrokSignIn } from '@/lib/engine/sign-in-ticket'
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
    supportsGrok: vi.fn<EngineClient['supportsGrok']>(),
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
    engine.supportsGrok.mockResolvedValue(true)
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

    it('offers Grok to a build that knows it, on a machine that runs it', async () => {
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '60')
        const { GET } = await import('@/app/api/v1/ai-connections/route')
        const view = (await expectContract(mobileApi.listAiConnections, await callRoute(GET, mobileApi.listAiConnections, { client: 'ios/1.6.0 (60)' }))) as z.infer<typeof aiConnectionsViewSchema>
        expect(view.addable.map(entry => entry.provider)).toEqual(['claude', 'codex', 'grok', 'opencode', 'anthropic', 'openai', 'google', 'openrouter', 'custom'])
        expect(view.addable.find(entry => entry.provider === 'grok')).toMatchObject({ kind: 'plan', title: 'SuperGrok', suggestedName: 'Grok', guide: null })

        engine.supportsGrok.mockResolvedValue(false)
        const older = (await expectContract(mobileApi.listAiConnections, await callRoute(GET, mobileApi.listAiConnections, { client: 'ios/1.6.0 (60)' }))) as z.infer<typeof aiConnectionsViewSchema>
        expect(older.addable.map(entry => entry.provider)).not.toContain('grok')
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

const grokDeviceCode = 'xai-device-code-01'
const grokStarted = () => Response.json({ device_code: grokDeviceCode, user_code: 'N4FS-5STQ', verification_uri: 'https://accounts.x.ai/oauth2/device', verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=N4FS-5STQ', expires_in: 1800, interval: 5 })
const grokIdToken = `x.${Buffer.from(JSON.stringify({ sub: 'xai-user-1' })).toString('base64url')}.y`
const grokApproved = () => Response.json({ access_token: 'grok-access', refresh_token: 'grok-refresh', id_token: grokIdToken, expires_in: 21600, token_type: 'Bearer' })
const grokPoll = (answer: () => Response) => ({ 'https://auth.x.ai/oauth2/token': answer })

describe('the Grok sign-in of the mobile app', () => {
    it('starts with the device code encrypted in the ticket, on a machine that runs Grok', async () => {
        providerEndpoints({ 'https://auth.x.ai/oauth2/device/code': grokStarted })
        const { POST } = await import('@/app/api/v1/ai-connections/grok/start/route')
        const start = await expectContract(mobileApi.startGrokSignIn, await callRoute(POST, mobileApi.startGrokSignIn))
        expect(start).toMatchObject({ ticket: expect.any(String), userCode: 'N4FS-5STQ', verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=N4FS-5STQ', pollIntervalMs: 5000 })
        expect(JSON.stringify(start)).not.toContain(grokDeviceCode)
        const sent = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0]![1]!.body))
        expect(Object.fromEntries(sent)).toEqual({ client_id: 'b1a00492-073a-47ea-816f-4c329264a828', scope: 'openid profile email offline_access grok-cli:access api:access' })
    })

    it('shows no address xAI answers with off its own sign-in page', async () => {
        providerEndpoints({ 'https://auth.x.ai/oauth2/device/code': () => Response.json({ device_code: grokDeviceCode, user_code: 'N4FS-5STQ', verification_uri_complete: 'https://evil.example/approve', expires_in: 1800, interval: 1 }) })
        const { POST } = await import('@/app/api/v1/ai-connections/grok/start/route')
        expect(await expectContract(mobileApi.startGrokSignIn, await callRoute(POST, mobileApi.startGrokSignIn))).toMatchObject({ verificationUrl: 'https://accounts.x.ai/oauth2/device', pollIntervalMs: 5000 })
    })

    it('says the machine has to update first when its engine does not run Grok', async () => {
        engine.supportsGrok.mockResolvedValue(false)
        providerEndpoints({})
        const { POST } = await import('@/app/api/v1/ai-connections/grok/start/route')
        const res = await callRoute(POST, mobileApi.startGrokSignIn)
        expect(await expectContract(mobileApi.startGrokSignIn, res, 400)).toMatchObject({ code: 'grokNeedsUpdate' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('answers pending until xAI approves, then stores the Grok tokens and hands none of them back', async () => {
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const ticket = mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 })
        for (const error of ['authorization_pending', 'slow_down']) {
            providerEndpoints(grokPoll(() => Response.json({ error }, { status: 400 })))
            expect(await expectContract(mobileApi.pollGrokSignIn, await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket } }))).toEqual({ status: 'pending' })
        }

        providerEndpoints(grokPoll(grokApproved))
        const done = await expectContract(mobileApi.pollGrokSignIn, await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket } }))
        expect(done).toEqual({ status: 'connected', connectionId: 'cnx-grok-2' })
        expect(JSON.stringify(done)).not.toContain('grok-access')
        expect(engine.createConnection).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ name: 'Grok', provider: 'grok', models: ['grok-4.6', 'grok-4.7', 'grok-4.7-build-fast', 'grok-4.5'], keys: expect.objectContaining({ GROK_OAUTH_TOKEN: 'grok-access', GROK_OAUTH_REFRESH_TOKEN: 'grok-refresh', GROK_OAUTH_ID_TOKEN: grokIdToken, GROK_OAUTH_ACCOUNT_ID: 'xai-user-1', GROK_OAUTH_EXPIRES_AT: expect.any(String) }) })
        )
        const sent = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0]![1]!.body))
        expect(Object.fromEntries(sent)).toEqual({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: grokDeviceCode, client_id: 'b1a00492-073a-47ea-816f-4c329264a828' })
    })

    it('signs an existing Grok connection in again, and refuses to land on another provider', async () => {
        engine.listConnections.mockResolvedValue({ connections: [claude, rerun, boxConnection({ id: 'cnx-grok', name: 'Grok', provider: 'grok', models: ['grok-4.6'], credentialRejected: true })], default: null, backups: { backups: [], rerunCreditLastResort: false } })
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const ticket = mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 })
        providerEndpoints(grokPoll(grokApproved))
        expect(await expectContract(mobileApi.pollGrokSignIn, await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket, connectionId: 'cnx-grok' } }))).toEqual({ status: 'connected', connectionId: 'cnx-grok' })
        expect(engine.updateConnectionKeys).toHaveBeenCalledWith(expect.anything(), 'cnx-grok', { set: expect.objectContaining({ GROK_OAUTH_TOKEN: 'grok-access' }), remove: [] })

        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket, connectionId: 'cnx-claude' } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 400)).toMatchObject({ code: 'signInOtherProvider' })
    })

    it.each([
        ['access_denied', 'grokSignInDenied'],
        ['expired_token', 'grokSignInExpired'],
        ['invalid_grant', 'grokSignInExpired'],
    ])('reads %s as %s, without xAI\'s words', async (error, code) => {
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        providerEndpoints(grokPoll(() => Response.json({ error, error_description: 'team 00000000-1111-4222' }, { status: 400 })))
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }) } })
        const body = await expectContract(mobileApi.pollGrokSignIn, res, 400)
        expect(body).toMatchObject({ code })
        expect(JSON.stringify(body)).not.toContain('00000000-1111')
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it.each([
        ['another person', () => mintGrokSignIn('user-grace', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }), 'This sign-in was started from another account. Start it again.'],
        ['another workspace', () => mintGrokSignIn('user-ada', 8, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }), 'This sign-in was started from another workspace. Start it again.'],
        ['the time it had', () => mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() - 3 * 60_000 }), 'Sign-in expired, please retry'],
        ['a Codex ticket', () => mintCodexSignIn('user-ada', { deviceAuthId: 'deviceauth_01', userCode: 'K7QX-M2PL' }), 'Invalid sign-in'],
        ['a forged one', () => `${mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }).slice(0, -4)}AAAA`, 'Invalid sign-in'],
        ['a cut tag', () => { const [iv, tag, body] = mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }).split('.'); return `${iv}.${Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url')}.${body}` }, 'Invalid sign-in'],
    ])('polls nothing for a ticket from %s', async (_name, ticket, error) => {
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        providerEndpoints(grokPoll(grokApproved))
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: ticket() } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 400)).toMatchObject({ error })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('hands an approved sign-in back to xAI when the machine cannot store it, and says to start again', async () => {
        engine.createConnection.mockRejectedValue(new Error('engine unreachable'))
        const revoke = vi.fn(() => new Response(null, { status: 200 }))
        providerEndpoints({ ...grokPoll(grokApproved), 'https://auth.x.ai/oauth2/revoke': revoke })
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }) } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 400)).toMatchObject({ code: 'grokSignInNotStored' })
        const revoked = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/oauth2/revoke')).map(([, init]) => new URLSearchParams(String(init!.body)).get('token'))
        expect(revoked).toEqual(['grok-refresh', 'grok-access'])
    })

    const grokTicket = () => mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 })
    const revokedTokens = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/oauth2/revoke'))
    const machineHolding = (...connections: BoxConnection[]) => ({ connections: [rerun, ...connections], default: null, backups: { backups: [], rerunCreditLastResort: false } })
    const grokOnMachine = (fields: Partial<BoxConnection> = {}) => boxConnection({ id: 'cnx-grok', name: 'Grok', provider: 'grok', models: ['grok-4.6'], ...fields })

    it('keeps a sign-in the machine stored although its answer never came back, and revokes nothing', async () => {
        let stored = false
        engine.listConnections.mockImplementation(async () => (stored ? machineHolding(grokOnMachine()) : machineHolding()))
        engine.createConnection.mockImplementation(async () => {
            stored = true
            throw new Error('The operation was aborted due to timeout')
        })
        providerEndpoints(grokPoll(grokApproved))
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: grokTicket() } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res)).toEqual({ status: 'connected', connectionId: 'cnx-grok' })
        expect(revokedTokens()).toHaveLength(0)
    })

    it('hands back a sign-in the machine refused outright, without asking it what it holds', async () => {
        const { EngineRequestError } = await import('@/lib/engine/client')
        engine.listConnections.mockResolvedValue(machineHolding())
        engine.createConnection.mockRejectedValue(new EngineRequestError('rerun-engine POST /connections failed: 400 {"error":"bad keys"}', 400))
        providerEndpoints({ ...grokPoll(grokApproved), 'https://auth.x.ai/oauth2/revoke': () => new Response(null, { status: 200 }) })
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: grokTicket() } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 400)).toMatchObject({ code: 'grokSignInNotStored' })
        expect(revokedTokens()).toHaveLength(2)
        expect(engine.listConnections).toHaveBeenCalledTimes(2)
    })

    it('revokes nothing while it cannot tell what the machine holds', async () => {
        let failed = false
        engine.listConnections.mockImplementation(async () => {
            if (failed) throw new Error('engine unreachable')
            return machineHolding()
        })
        engine.createConnection.mockImplementation(async () => {
            failed = true
            throw new Error('engine unreachable')
        })
        providerEndpoints(grokPoll(grokApproved))
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: grokTicket() } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 400)).toMatchObject({ code: 'grokSignInNotStored' })
        expect(revokedTokens()).toHaveLength(0)
    })

    it.each([
        ['back on its feet', false, { status: 'connected', connectionId: 'cnx-grok' }, undefined],
        ['still turned away', true, { code: 'grokSignInNotStored' }, 400],
    ] as const)('never revokes the keys sent to a connection signed in again, whether it reads %s or not', async (_name, stillRejected, answer, status) => {
        let sent = false
        engine.listConnections.mockImplementation(async () => machineHolding(grokOnMachine({ credentialRejected: !sent || stillRejected })))
        engine.updateConnectionKeys.mockImplementation(async () => {
            sent = true
            throw new Error('The operation was aborted due to timeout')
        })
        providerEndpoints(grokPoll(grokApproved))
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: grokTicket(), connectionId: 'cnx-grok' } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, status)).toMatchObject(answer)
        expect(revokedTokens()).toHaveLength(0)
    })

    it('drops what an earlier Grok sign-in left that the new one does not carry', async () => {
        engine.listConnections.mockResolvedValue({ connections: [rerun, boxConnection({ id: 'cnx-grok', name: 'Grok', provider: 'grok', models: ['grok-4.6'] })], default: null, backups: { backups: [], rerunCreditLastResort: false } })
        providerEndpoints(grokPoll(() => Response.json({ access_token: 'grok-access', refresh_token: 'grok-refresh', expires_in: 21600 })))
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }), connectionId: 'cnx-grok' } })
        expect(engine.updateConnectionKeys).toHaveBeenCalledWith(expect.anything(), 'cnx-grok', { set: expect.objectContaining({ GROK_OAUTH_TOKEN: 'grok-access' }), remove: ['GROK_OAUTH_ID_TOKEN', 'GROK_OAUTH_ACCOUNT_ID'] })
    })

    it('refuses to store a Grok sign-in on a workspace without a plan, with its reason', async () => {
        withoutPlan()
        providerEndpoints(grokPoll(grokApproved))
        const { POST } = await import('@/app/api/v1/ai-connections/grok/poll/route')
        const res = await callRoute(POST, mobileApi.pollGrokSignIn, { body: { ticket: mintGrokSignIn('user-ada', 7, { deviceCode: grokDeviceCode, expiresAt: Date.now() + 1_800_000 }) } })
        expect(await expectContract(mobileApi.pollGrokSignIn, res, 403)).toMatchObject({ reason: 'no_plan' })
    })

    it('never takes a Grok token pasted by hand, to add a connection or to replace its key', async () => {
        const list = await import('@/app/api/v1/ai-connections/route')
        const added = await callRoute(list.POST, mobileApi.createAiConnection, { body: { provider: 'grok', apiKey: 'xai-token-from-elsewhere' } })
        expect(await expectContract(mobileApi.createAiConnection, added, 400)).toMatchObject({ code: 'grokSignInOnly' })

        engine.listConnections.mockResolvedValue({ connections: [rerun, boxConnection({ id: 'cnx-grok', name: 'Grok', provider: 'grok', models: ['grok-4.6'] })], default: null, backups: { backups: [], rerunCreditLastResort: false } })
        const keys = await import('@/app/api/v1/ai-connections/[id]/keys/route')
        const replaced = await callRoute(keys.PUT, mobileApi.replaceAiConnectionKey, { params: { id: 'cnx-grok' }, body: { apiKey: 'xai-token-from-elsewhere' } })
        expect(await expectContract(mobileApi.replaceAiConnectionKey, replaced, 400)).toMatchObject({ code: 'grokSignInOnly' })
        expect(engine.createConnection).not.toHaveBeenCalled()
        expect(engine.updateConnectionKeys).not.toHaveBeenCalled()
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
        ['startGrokSignIn', mobileApi.startGrokSignIn, async () => callRoute((await import('@/app/api/v1/ai-connections/grok/start/route')).POST, mobileApi.startGrokSignIn)],
        ['pollGrokSignIn', mobileApi.pollGrokSignIn, async () => callRoute((await import('@/app/api/v1/ai-connections/grok/poll/route')).POST, mobileApi.pollGrokSignIn, { body: { ticket: mintGrokSignIn('user-ada', 7, { deviceCode: 'xai-device-code-01', expiresAt: Date.now() + 1_800_000 }) } })],
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
