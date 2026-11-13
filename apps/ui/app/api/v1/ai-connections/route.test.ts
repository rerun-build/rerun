import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = { id: 7, subscription_status: 'active', is_sandbox: false, rerun_used_micros: 2_000_000, rerun_budget_micros: 10_000_000, rerun_topup_micros: 0, current_period_end: '2026-11-01T00:00:00Z' }
let signedIn = true
let role: 'admin' | 'member' = 'admin'
// The dialog of a workspace on Rerun Cloud's plans: the billing of ee/ is pinned here, whatever the
// build resolves @rerun/cloud/billing to.
vi.mock('@rerun/cloud/billing', async () => ({
    ...(await vi.importActual<typeof import('@/ee/lib/billing/entitlement')>('@/ee/lib/billing/entitlement')),
    ...(await vi.importActual<typeof import('@/ee/lib/billing/plans')>('@/ee/lib/billing/plans')),
    BILLING_ENABLED: true,
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => {
    const actual = await importOriginal<typeof import('@/app/api/_auth/ownership')>()
    const requireWorkspaceContext = async () => {
        if (!signedIn) throw new actual.UnauthenticatedError()
        return { userId: 'user-1', workspace, role, supabase: {} }
    }
    return {
        ...actual,
        requireWorkspaceContext,
        requireAdminContext: async () => {
            const ctx = await requireWorkspaceContext()
            if (ctx.role !== 'admin') throw new actual.AuthorizationError(actual.ADMIN_ONLY)
            return ctx
        },
    }
})
vi.mock('@/lib/i18n/recipient-locale', () => ({ recipientLocale: vi.fn(async () => 'en') }))
// The plan read before a Claude sign-in is stored: a workspace on Rerun Cloud's plans, not a lifetime one.
vi.mock('@/supabase/serviceRole', async () => {
    const { fakeSupabase } = await import('@/test/supabase-fake')
    return { createServiceRoleClient: () => fakeSupabase(table => (table === 'workspaces' ? { data: { plan: 'base' } } : undefined)).client }
})
vi.mock('@/app/api/_services/capacity.service', () => ({
    NoPlanError: class NoPlanError extends Error {
        constructor() {
            super('This workspace has no active plan.')
        }
    },
}))
const assertModelEntitled = vi.fn()
vi.mock('@/app/api/_services/engine-plan.service', async importOriginal => ({
    ModelNotEntitledError: (await importOriginal<typeof import('@/app/api/_services/engine-plan.service')>()).ModelNotEntitledError,
    assertModelEntitled: (...args: unknown[]) => assertModelEntitled(...args),
}))
const conn = { baseUrl: 'https://engine.test', apiKey: 'box-key' }
const findWorkspaceEngine = vi.fn()
const ensureWorkspaceEngine = vi.fn()
vi.mock('@/app/api/_services/workspace-engine.service', () => ({
    findWorkspaceEngine: (...args: unknown[]) => findWorkspaceEngine(...args),
    ensureWorkspaceEngine: (...args: unknown[]) => ensureWorkspaceEngine(...args),
    getWorkspaceConnection: async () => conn,
}))
let opencodeEnabled = false
vi.mock('@/lib/features', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/features')>()),
    get OPENCODE_ENABLED() {
        return opencodeEnabled
    },
}))
let cloud = true
vi.mock('@rerun/cloud/edition', () => ({
    get RERUN_CLOUD() {
        return cloud
    },
}))
const engine = {
    supportsOpencode: vi.fn(),
    supportsCustomProvider: vi.fn(),
    probeCustomEndpoint: vi.fn(),
    listConnections: vi.fn(),
    createConnection: vi.fn(),
    patchConnection: vi.fn(),
    updateConnectionKeys: vi.fn(),
    setBoxDefault: vi.fn(),
    getConnectionUsage: vi.fn(),
    deleteConnection: vi.fn(),
}
vi.mock('@/lib/engine/client', async importOriginal => ({
    EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError,
    listConnections: (...args: unknown[]) => engine.listConnections(...args),
    supportsOpencode: (...args: unknown[]) => engine.supportsOpencode(...args),
    supportsCustomProvider: (...args: unknown[]) => engine.supportsCustomProvider(...args),
    probeCustomEndpoint: (...args: unknown[]) => engine.probeCustomEndpoint(...args),
    createConnection: (...args: unknown[]) => engine.createConnection(...args),
    patchConnection: (...args: unknown[]) => engine.patchConnection(...args),
    updateConnectionKeys: (...args: unknown[]) => engine.updateConnectionKeys(...args),
    setBoxDefault: (...args: unknown[]) => engine.setBoxDefault(...args),
    getConnectionUsage: (...args: unknown[]) => engine.getConnectionUsage(...args),
    deleteConnection: (...args: unknown[]) => engine.deleteConnection(...args),
}))
const providerKeyProblem = vi.fn()
vi.mock('@/lib/engine/verify-provider-key', () => ({ providerKeyProblem: (...args: unknown[]) => providerKeyProblem(...args) }))
const exchangeClaudeCode = vi.fn()
vi.mock('@/lib/engine/claude-oauth', () => ({ buildClaudeAuthorize: () => ({ authorizeUrl: 'https://claude.ai/oauth', verifier: 'v', state: 's' }), exchangeClaudeCode: (...args: unknown[]) => exchangeClaudeCode(...args) }))
const pollCodexDeviceAuth = vi.fn()
vi.mock('@/lib/engine/codex-oauth', () => ({
    startCodexDeviceAuth: vi.fn(),
    pollCodexDeviceAuth: (...args: unknown[]) => pollCodexDeviceAuth(...args),
    codexKeysFrom: () => ({ CODEX_OAUTH_TOKEN: 'access', CODEX_OAUTH_REFRESH_TOKEN: 'refresh' }),
}))

vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
const { mintClaudeSignIn, mintCodexSignIn } = await import('@/lib/engine/sign-in-ticket')
const claudeStart = await import('./claude/start/route')
const codexStart = await import('./codex/start/route')
const list = await import('./route')
const defaultRoute = await import('./default/route')
const keysRoute = await import('./[id]/keys/route')
const connectionRoute = await import('./[id]/route')
const usageRoute = await import('./[id]/usage/route')
const claudeFinish = await import('./claude/finish/route')
const codexPoll = await import('./codex/poll/route')
const { EngineRequestError } = await import('@/lib/engine/client')

const base = 'https://app.rerun.build/api/v1/ai-connections'
const send = (handler: (req: Request, segment: { params: Promise<Record<string, string>> }) => Promise<Response>, method: string, path = '', body?: object, params: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    handler(new Request(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve(params) })

const connection = (overrides: object) => ({ name: 'X', provider: 'anthropic', models: [], extraModels: [], createdAt: '', connected: true, credentialRejected: false, planLimits: null, ...overrides })
const rerun = connection({ id: 'rerun', name: 'Rerun', provider: 'rerun', models: ['rerun-max'] })
const claude = connection({ id: 'cnx-claude', name: 'Claude', provider: 'claude', models: ['claude-opus-5-5', 'claude-sonnet-4-6'] })

beforeEach(() => {
    signedIn = true
    role = 'admin'
    vi.clearAllMocks()
    findWorkspaceEngine.mockResolvedValue({ instanceId: 'i', conn, managed: true })
    engine.listConnections.mockResolvedValue({ connections: [claude, rerun], default: null })
    engine.createConnection.mockImplementation(async (_conn: unknown, params: { name: string; provider: string }) => connection({ id: 'cnx-new', ...params }))
    providerKeyProblem.mockResolvedValue(null)
    opencodeEnabled = false
    engine.supportsOpencode.mockResolvedValue(true)
    engine.supportsCustomProvider.mockResolvedValue(false)
    cloud = true
    vi.unstubAllEnvs()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
})

describe('GET /api/v1/ai-connections', () => {
    it('shapes the web dialog for the app: Rerun first, the default on Rerun when none is set, premium models locked on a trial', async () => {
        workspace.subscription_status = 'trialing'
        const view = await (await send(list.GET, 'GET')).json()
        workspace.subscription_status = 'active'
        expect(view.connections.map((entry: { id: string }) => entry.id)).toEqual(['rerun', 'cnx-claude'])
        expect(view.default).toEqual({ connectionId: 'rerun', model: 'rerun-max', label: expect.any(String) })
        expect(view.connections[0]).toMatchObject({ kind: 'included', status: 'connected', isDefault: true, summary: "20% of this month's credits used" })
        const opus = view.connections[1].models.find((model: { id: string }) => model.id === 'claude-opus-5-5')
        expect(opus).toMatchObject({ enabled: true, locked: true })
        expect(view.addable.map((entry: { provider: string }) => entry.provider)).toEqual(['claude', 'codex', 'anthropic', 'openai', 'google', 'openrouter'])
        expect(view.addable[0]).toMatchObject({ kind: 'plan', suggestedName: 'Claude 2', guide: null })
        expect(view.addable[2].guide).toMatchObject({ title: 'How to get your Anthropic key' })
    })

    it('asks a signed-in user to reconnect a credential its provider turned away', async () => {
        engine.listConnections.mockResolvedValue({ connections: [rerun, { ...claude, credentialRejected: true }], default: null })
        const view = await (await send(list.GET, 'GET')).json()
        expect(view.connections[1]).toMatchObject({ status: 'reconnect', credentialOnFile: true })
    })

    it('answers an empty list for a workspace whose machine is not claimed yet, and 401 without a session', async () => {
        findWorkspaceEngine.mockResolvedValue(null)
        expect((await (await send(list.GET, 'GET')).json()).connections).toEqual([])
        signedIn = false
        expect((await send(list.GET, 'GET')).status).toBe(401)
    })
})

describe('OpenCode', () => {
    const opencode = connection({ id: 'cnx-oc', name: 'OpenCode', provider: 'opencode', models: ['go/deepseek-v4-pro'] })
    const addable = async (headers: Record<string, string> = {}) => ((await (await send(list.GET, 'GET', '', undefined, {}, headers)).json()) as { addable: { provider: string }[] }).addable.map(entry => entry.provider)
    const iosBuild = (build: number) => ({ 'x-rerun-client': `ios/1.4.0 (${build})` })

    it('is offered only behind its flag, and only on a machine whose engine runs it', async () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        expect(await addable(iosBuild(40))).not.toContain('opencode')
        opencodeEnabled = true
        expect(await addable(iosBuild(40))).toEqual(['claude', 'codex', 'opencode', 'anthropic', 'openai', 'google', 'openrouter'])
        engine.supportsOpencode.mockResolvedValue(false)
        expect(await addable(iosBuild(40))).not.toContain('opencode')
    })

    it('refuses to create one with the flag off, or on an engine that predates it', async () => {
        const create = () => send(list.POST, 'POST', '', { provider: 'opencode', apiKey: 'oc_sk_key' })
        expect((await (await create()).json()).error).toBe('OpenCode is not available yet.')
        opencodeEnabled = true
        engine.supportsOpencode.mockResolvedValue(false)
        expect((await (await create()).json()).error).toContain('next update of this machine')
        engine.supportsOpencode.mockResolvedValue(true)
        expect(await (await create()).json()).toEqual({ connectionId: 'cnx-new' })
        expect(engine.createConnection).toHaveBeenLastCalledWith(conn, expect.objectContaining({ provider: 'opencode', keys: { OPENCODE_API_KEY: 'oc_sk_key' }, models: expect.arrayContaining(['go/deepseek-v4-pro']) }))
    })

    // An iOS build that predates OpenCode parses the provider strictly and would drop the whole list.
    it('stays out of the list an older iOS build reads, or one that sends no header', async () => {
        opencodeEnabled = true
        engine.listConnections.mockResolvedValue({ connections: [rerun, opencode], default: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' } })
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        const ids = async (headers: Record<string, string>) => ((await (await send(list.GET, 'GET', '', undefined, {}, headers)).json()) as { connections: { id: string }[] }).connections.map(entry => entry.id)
        expect(await ids({})).toEqual(['rerun'])
        expect(await ids(iosBuild(39))).toEqual(['rerun'])
        expect(await addable(iosBuild(39))).not.toContain('opencode')
        expect(await ids(iosBuild(40))).toEqual(['rerun', 'cnx-oc'])
    })
})

describe('custom endpoints', () => {
    const addable = async (headers: Record<string, string> = {}) => ((await (await send(list.GET, 'GET', '', undefined, {}, headers)).json()) as { addable: { provider: string }[] }).addable.map(entry => entry.provider)
    const create = (body: object) => send(list.POST, 'POST', '', { provider: 'custom', ...body })

    it('are offered last among the API keys, only on a machine whose engine runs them, and to an iOS build that knows them', async () => {
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '50')
        const current = { 'x-rerun-client': 'ios/1.5.0 (50)' }
        expect(await addable(current)).not.toContain('custom')
        engine.supportsCustomProvider.mockResolvedValue(true)
        expect(await addable(current)).toEqual(['claude', 'codex', 'anthropic', 'openai', 'google', 'openrouter', 'custom'])
        expect(await addable({ 'x-rerun-client': 'ios/1.4.0 (49)' })).not.toContain('custom')
    })

    it('take no key, and keep the models the endpoint listed', async () => {
        cloud = false
        engine.supportsCustomProvider.mockResolvedValue(true)
        expect(await (await create({ baseUrl: 'https://llm.acme.com/v1', models: ['qwen3:4b'] })).json()).toEqual({ connectionId: 'cnx-new' })
        expect(engine.createConnection).toHaveBeenLastCalledWith(conn, expect.objectContaining({ name: 'Custom', provider: 'custom', baseUrl: 'https://llm.acme.com/v1', models: ['qwen3:4b'], keys: {} }))
        expect(providerKeyProblem).toHaveBeenCalledWith('custom', {}, 'https://llm.acme.com/v1')
    })

    it('need an address, and an engine that knows them', async () => {
        cloud = false
        engine.supportsCustomProvider.mockResolvedValue(true)
        expect((await create({})).status).toBe(400)
        engine.supportsCustomProvider.mockResolvedValue(false)
        expect((await (await create({ baseUrl: 'https://llm.acme.com/v1' })).json()).error).toContain('next update of this machine')
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    // On Rerun Cloud the box would send the key to the host's own network; a self-hosted install
    // runs on its owner's, where Ollama listens.
    it('refuse a private address on Rerun Cloud and take it on a self-hosted install', async () => {
        engine.supportsCustomProvider.mockResolvedValue(true)
        const refused = await create({ baseUrl: 'http://192.168.1.20:11434/v1' })
        expect(refused.status).toBe(400)
        expect(await refused.json()).toEqual({ error: 'The base URL must be a public web address.' })
        cloud = false
        expect(await (await create({ baseUrl: 'http://192.168.1.20:11434/v1' })).json()).toEqual({ connectionId: 'cnx-new' })
    })
})

describe('POST /api/v1/ai-connections', () => {
    it('answers 403 to a member who is not an admin, while the list stays readable', async () => {
        role = 'member'
        const refused = await send(list.POST, 'POST', '', { provider: 'anthropic', apiKey: 'sk-ant-api03-key' })
        expect(refused.status).toBe(403)
        expect(engine.createConnection).not.toHaveBeenCalled()
        expect((await send(list.GET, 'GET', '')).status).toBe(200)
    })

    it('stores the key under the provider’s own env var, with the default models and a name not taken yet', async () => {
        expect(await (await send(list.POST, 'POST', '', { provider: 'claude', apiKey: ' sk-ant-oat01-token ' })).json()).toEqual({ connectionId: 'cnx-new' })
        expect(engine.createConnection).toHaveBeenCalledWith(conn, expect.objectContaining({ name: 'Claude 2', provider: 'claude', keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-token' } }))
        expect(engine.createConnection.mock.calls[0][1].models.length).toBeGreaterThan(0)
    })

    it('refuses the code Claude shows in place of a token, and a key its provider turns down', async () => {
        const code = await send(list.POST, 'POST', '', { provider: 'claude', apiKey: 'abc#def' })
        expect(code.status).toBe(400)
        providerKeyProblem.mockResolvedValue({ code: 'providerKeyRejected', params: { provider: 'Anthropic' } })
        const refused = await send(list.POST, 'POST', '', { provider: 'anthropic', apiKey: 'sk-ant-api03-bad' })
        expect(refused.status).toBe(400)
        expect(await refused.json()).toEqual({ error: 'Anthropic turned this key down. Check it was copied in full and is still active.' })
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('says so when the workspace has no plan, without a pitch', async () => {
        const { NoPlanError } = await import('@/app/api/_services/capacity.service')
        findWorkspaceEngine.mockResolvedValue(null)
        ensureWorkspaceEngine.mockRejectedValue(new NoPlanError())
        const res = await send(list.POST, 'POST', '', { provider: 'openai', apiKey: 'sk-key' })
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ reason: 'no_plan' })
    })
})

describe('PUT /api/v1/ai-connections/default', () => {
    it('sets the pair, clears it back to Rerun, and refuses a model the plan does not include', async () => {
        expect((await send(defaultRoute.PUT, 'PUT', '/default', { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' })).status).toBe(204)
        expect(engine.setBoxDefault).toHaveBeenLastCalledWith(conn, { connectionId: 'cnx-claude', model: 'claude-sonnet-4-6' })
        expect((await send(defaultRoute.PUT, 'PUT', '/default', { connectionId: null, model: null })).status).toBe(204)
        expect(engine.setBoxDefault).toHaveBeenLastCalledWith(conn, null)
        const { ModelNotEntitledError } = await import('@/app/api/_services/engine-plan.service')
        assertModelEntitled.mockRejectedValue(new ModelNotEntitledError('claude-opus-5-5'))
        const refused = await send(defaultRoute.PUT, 'PUT', '/default', { connectionId: 'cnx-claude', model: 'claude-opus-5-5' })
        expect(refused.status).toBe(403)
        expect(await refused.json()).toEqual({ error: 'This model is not included in your plan.' })
    })
})

describe('/api/v1/ai-connections/:id', () => {
    it('replaces the key of the connection under its provider’s env var, drops the old refresh material, and never touches Rerun', async () => {
        expect((await send(keysRoute.PUT, 'PUT', '/cnx-claude/keys', { apiKey: 'sk-ant-oat01-new' }, { id: 'cnx-claude' })).status).toBe(204)
        expect(engine.updateConnectionKeys).toHaveBeenCalledWith(conn, 'cnx-claude', { set: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-new' }, remove: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_EXPIRES_AT'] })
        expect((await send(keysRoute.PUT, 'PUT', '/rerun/keys', { apiKey: 'x' }, { id: 'rerun' })).status).toBe(404)
    })

    it('reads a connection the machine no longer has as missing, and never deletes Rerun', async () => {
        expect((await send(connectionRoute.PATCH, 'PATCH', '/gone', { name: 'New' }, { id: 'gone' })).status).toBe(404)
        expect(engine.patchConnection).not.toHaveBeenCalled()
        expect((await send(connectionRoute.DELETE, 'DELETE', '/rerun', undefined, { id: 'rerun' })).status).toBe(400)
        expect(engine.deleteConnection).not.toHaveBeenCalled()
    })

    it('never hands an id the machine does not list to the engine, path-shaped or not', async () => {
        const forged = '../agents/engine-agent'
        expect((await send(connectionRoute.DELETE, 'DELETE', '/..%2Fagents%2Fengine-agent', undefined, { id: forged })).status).toBe(404)
        expect((await send(usageRoute.GET, 'GET', '/..%2Fagents%2Fengine-agent/usage', undefined, { id: forged })).status).toBe(404)
        expect((await send(connectionRoute.PATCH, 'PATCH', '/x', { name: 'New' }, { id: forged })).status).toBe(404)
        expect(engine.deleteConnection).not.toHaveBeenCalled()
        expect(engine.getConnectionUsage).not.toHaveBeenCalled()
        expect(engine.patchConnection).not.toHaveBeenCalled()

        engine.getConnectionUsage.mockResolvedValue({ agents: [], schedules: [], triggers: [] })
        expect((await send(usageRoute.GET, 'GET', '/cnx-claude/usage', undefined, { id: 'cnx-claude' })).status).toBe(200)
        expect(engine.getConnectionUsage).toHaveBeenCalledWith(conn, 'cnx-claude')
    })
})

describe('subscription sign-ins', () => {
    const claudeTicket = () => mintClaudeSignIn('user-1', { verifier: 'v', state: 's' })
    const codexTicket = () => mintCodexSignIn('user-1', { deviceAuthId: 'd', userCode: 'ABCD' })

    // A sign-in ends in storeSignInKeys, which adds a provider or replaces its keys: the same writes
    // POST /ai-connections and PUT /:id/keys refuse a member, so every step of it is admin only.
    it('answers 403 to a member at every step, start and finish alike', async () => {
        role = 'member'
        expect((await send(claudeStart.POST, 'POST', '/claude/start')).status).toBe(403)
        expect((await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc', ticket: claudeTicket() })).status).toBe(403)
        expect((await send(codexStart.POST, 'POST', '/codex/start')).status).toBe(403)
        expect((await send(codexPoll.POST, 'POST', '/codex/poll', { ticket: codexTicket() })).status).toBe(403)
        expect(exchangeClaudeCode).not.toHaveBeenCalled()
        expect(pollCodexDeviceAuth).not.toHaveBeenCalled()
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('hands the phone a sealed ticket in place of the PKCE pair, and exchanges the code with it', async () => {
        const start = await (await send(claudeStart.POST, 'POST', '/claude/start')).json()
        expect(start).toEqual({ authorizeUrl: 'https://claude.ai/oauth', ticket: expect.any(String) })
        expect(JSON.stringify(start)).not.toContain('"verifier"')

        exchangeClaudeCode.mockResolvedValue({ accessToken: 'sk-ant-oat01-access', refreshToken: 'refresh', expiresAt: 123 })
        const res = await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc#s', ticket: start.ticket })
        expect(await res.json()).toEqual({ connectionId: 'cnx-new' })
        expect(exchangeClaudeCode).toHaveBeenCalledWith('abc#s', 'v', 's')
        expect(engine.createConnection).toHaveBeenCalledWith(conn, expect.objectContaining({ provider: 'claude', keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-access', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh', CLAUDE_CODE_OAUTH_EXPIRES_AT: '123' } }))
    })

    it('signs an existing Claude connection in again instead of adding one, and passes on why a code failed', async () => {
        exchangeClaudeCode.mockResolvedValue({ accessToken: 'sk-ant-oat01-access' })
        expect(await (await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc', ticket: claudeTicket(), connectionId: 'cnx-claude' })).json()).toEqual({ connectionId: 'cnx-claude' })
        expect(engine.updateConnectionKeys).toHaveBeenCalledWith(conn, 'cnx-claude', { set: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-access' } })
        expect(engine.createConnection).not.toHaveBeenCalled()
        exchangeClaudeCode.mockRejectedValue(new Error('Token exchange failed (400)'))
        const failed = await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc', ticket: claudeTicket() })
        expect(failed.status).toBe(400)
        expect(await failed.json()).toEqual({ error: 'Token exchange failed (400)' })
    })

    it('exchanges nothing for a ticket another person started, or a forged one', async () => {
        const other = await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc', ticket: mintClaudeSignIn('user-2', { verifier: 'v', state: 's' }) })
        expect(other.status).toBe(400)
        expect(await other.json()).toEqual({ error: 'This sign-in was started from another account. Start it again.' })
        expect((await send(claudeFinish.POST, 'POST', '/claude/finish', { code: 'abc', ticket: 'forged.ticket' })).status).toBe(400)
        expect(exchangeClaudeCode).not.toHaveBeenCalled()
    })

    it('answers pending until OpenAI approves, then stores the Codex tokens, and never onto another provider', async () => {
        pollCodexDeviceAuth.mockResolvedValue(null)
        expect(await (await send(codexPoll.POST, 'POST', '/codex/poll', { ticket: codexTicket() })).json()).toEqual({ status: 'pending' })
        expect(pollCodexDeviceAuth).toHaveBeenCalledWith('d', 'ABCD')
        pollCodexDeviceAuth.mockResolvedValue({ access_token: 'access' })
        expect(await (await send(codexPoll.POST, 'POST', '/codex/poll', { ticket: codexTicket() })).json()).toEqual({ status: 'connected', connectionId: 'cnx-new' })
        expect(engine.createConnection).toHaveBeenCalledWith(conn, expect.objectContaining({ name: 'ChatGPT', provider: 'codex' }))
        expect((await send(codexPoll.POST, 'POST', '/codex/poll', { ticket: codexTicket(), connectionId: 'cnx-claude' })).status).toBe(400)
        expect(engine.updateConnectionKeys).not.toHaveBeenCalled()
    })

    it('polls nothing for a device auth another person started, and keeps its id off the phone', async () => {
        const { startCodexDeviceAuth } = await import('@/lib/engine/codex-oauth')
        vi.mocked(startCodexDeviceAuth).mockResolvedValue({ deviceAuthId: 'd', userCode: 'ABCD', verificationUrl: 'https://auth.openai.com/codex/device', pollIntervalMs: 5000, expiresAt: 1 })
        const start = await (await send(codexStart.POST, 'POST', '/codex/start')).json()
        expect(start).toEqual({ ticket: expect.any(String), userCode: 'ABCD', verificationUrl: 'https://auth.openai.com/codex/device', pollIntervalMs: 5000, expiresAt: 1 })

        expect((await send(codexPoll.POST, 'POST', '/codex/poll', { ticket: mintCodexSignIn('user-2', { deviceAuthId: 'd', userCode: 'ABCD' }) })).status).toBe(400)
        expect(pollCodexDeviceAuth).not.toHaveBeenCalled()
    })
})
