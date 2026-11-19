import { agentDetailSchema, mobileApi, type McpServerStatus, type RemoteComputerView } from '@rerun/contracts'
import type { z } from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import type { ParkedSignIn } from '@/lib/oauth/pending-grant'
import type { serviceManifestSchema } from '@/lib/services/manifest'
import type { ServiceRegistry } from '@/lib/services/registry'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, type FakeSupabase } from '@/test/supabase-fake'

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
type Rows<T extends keyof Database['public']['Tables']> = Partial<Row<T>>[]

// The apps of a coworker (catalog services and servers registered outside it), their sign-ins, and
// the computers of the workspace. The services run for real on a fake database; the coworker's box
// is the engine HTTP client, answered from the registry file and the servers it holds.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null }))

const engine = vi.hoisted(() => ({
    getAgent: vi.fn<typeof import('@/lib/engine/client').getAgent>(),
    getMcpServerStatuses: vi.fn<typeof import('@/lib/engine/client').getMcpServerStatuses>(),
    readFileText: vi.fn<typeof import('@/lib/engine/client').readFileText>(),
    writeFileText: vi.fn<typeof import('@/lib/engine/client').writeFileText>(),
    makeDir: vi.fn<typeof import('@/lib/engine/client').makeDir>(),
    supportsVault: vi.fn<typeof import('@/lib/engine/client').supportsVault>(),
    putMcpToken: vi.fn<typeof import('@/lib/engine/client').putMcpToken>(),
    updateAgentKeys: vi.fn<typeof import('@/lib/engine/client').updateAgentKeys>(),
    patchMcpServers: vi.fn<typeof import('@/lib/engine/client').patchMcpServers>(),
    createSkill: vi.fn<typeof import('@/lib/engine/client').createSkill>(),
    supportsRemoteComputers: vi.fn<typeof import('@/lib/engine/client').supportsRemoteComputers>(),
}))

const remote = vi.hoisted(() => ({
    listRemoteComputers: vi.fn<typeof import('@/lib/engine/remote-client').listRemoteComputers>(),
    upsertRemoteComputer: vi.fn<typeof import('@/lib/engine/remote-client').upsertRemoteComputer>(),
    addRemoteComputerRule: vi.fn<typeof import('@/lib/engine/remote-client').addRemoteComputerRule>(),
}))

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
vi.mock('@/supabase/session/getServerSession', async importOriginal => ({ ...(await importOriginal<typeof import('@/supabase/session/getServerSession')>()), getAuthUser: async () => state.ctx?.authUser }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), ...engine }))
vi.mock('@/lib/engine/remote-client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/remote-client')>()), ...remote }))

const AGENT_ID = '5b0f8f7e-3c1d-4b8a-9f62-0d7c1e4a2b91'
const ENGINE_AGENT_ID = 'scout'
const STUDIO_MAC = '0c6f1d2e-8a4b-4f3c-b1e7-6d9a2c5f0e14'
const OFFICE_PC = '9e2a7b41-5d3c-4c8f-a0b6-1f4e8d7c3a25'

type ManifestInput = z.input<typeof serviceManifestSchema>

const stripeManifest: ManifestInput = {
    slug: 'stripe',
    name: 'Stripe',
    category: 'payments',
    summary: 'Payments, customers and invoices',
    authMethods: [
        {
            id: 'api-key',
            label: 'Secret key',
            kind: 'key',
            recommended: true,
            inputs: [{ key: 'STRIPE_SECRET_KEY', label: 'Secret key', type: 'password', secret: true }],
            mcpServers: [{ name: 'stripe', transport: 'http', url: 'https://mcp.stripe.com', headers: { Authorization: 'Bearer ${input.STRIPE_SECRET_KEY}' } }],
        },
    ],
}

const linearManifest: ManifestInput = {
    slug: 'linear',
    name: 'Linear',
    category: 'productivity',
    summary: 'Issues, projects and cycles',
    authMethods: [{ id: 'oauth', label: 'Sign in with Linear', kind: 'oauth', recommended: true, mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', oauth: {} }] }],
}

const notionManifest: ManifestInput = {
    slug: 'notion',
    name: 'Notion',
    category: 'productivity',
    summary: 'Pages and databases',
    authMethods: [{ id: 'oauth', label: 'Sign in with Notion', kind: 'oauth', recommended: true, mcpServers: [{ name: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp', oauth: {} }] }],
}

const services: Rows<'services'> = [
    { slug: 'stripe', name: 'Stripe', category: 'payments', summary: 'Payments, customers and invoices', icon: 'https://cdn.rerun.build/services/stripe.svg', manifest: stripeManifest, verified: true, enabled: true },
    { slug: 'linear', name: 'Linear', category: 'productivity', summary: 'Issues, projects and cycles', icon: 'https://cdn.rerun.build/services/linear.svg', manifest: linearManifest, verified: true, enabled: true },
    { slug: 'notion', name: 'Notion', category: 'productivity', summary: 'Pages and databases', icon: 'https://cdn.rerun.build/services/notion.svg', manifest: notionManifest, verified: false, enabled: true },
]

// The join `space:spaces(visibility)` the chat target reads comes back nested in the agent row.
const agents: (Partial<Row<'agents'>> & { space: Pick<Row<'spaces'>, 'visibility'> })[] = [
    { id: AGENT_ID, workspace_id: 7, space_id: 'space-sales', engine_agent_id: ENGINE_AGENT_ID, disabled_at: null, disabled_reason: null, space: { visibility: 'workspace' } },
]

const remoteComputers: Rows<'remote_computers'> = [
    { id: STUDIO_MAC, workspace_id: 7, name: 'Studio Mac', handle: 'studio-mac', os: 'mac', arch: 'arm64', hostname: 'studio.local', app_version: '1.4.0', linked_by: 'user-ada', last_seen_at: '2026-11-19T08:40:00.000Z', revoked_at: null, created_at: '2026-11-03T10:00:00.000Z' },
    { id: OFFICE_PC, workspace_id: 7, name: 'Office PC', handle: 'office-pc', os: 'win', arch: 'x64', hostname: 'OFFICE-PC', app_version: '1.3.2', linked_by: 'user-ada', last_seen_at: '2026-11-12T17:05:00.000Z', revoked_at: null, created_at: '2026-11-05T14:30:00.000Z' },
]

const parkedMcp: ParkedSignIn = { kind: 'mcp', serverName: 'notion', token: { accessToken: 'ntn_at_9f2c', refreshToken: 'ntn_rt_41ab', expiresAt: 1795000000000 } }
const parkedLinear: ParkedSignIn = { kind: 'mcp', serverName: 'linear', token: { accessToken: 'lin_oauth_7d1e', refreshToken: 'lin_rt_0b3a' } }

const inTenMinutes = () => new Date(Date.now() + 600_000).toISOString()

const pendingGrants = (): Rows<'oauth_pending_grants'> => [
    { jti: 'claim-notion', agent_id: AGENT_ID, workspace_id: 7, user_id: 'user-ada', kind: 'mcp', payload: parkedMcp, expires_at: inTenMinutes(), created_at: '2026-11-19T09:00:00.000Z' },
    { jti: 'claim-linear', agent_id: AGENT_ID, workspace_id: 7, user_id: 'user-ada', kind: 'mcp', payload: parkedLinear, expires_at: inTenMinutes(), created_at: '2026-11-19T09:00:00.000Z' },
]

const tables = () => ({
    agents,
    services,
    spaces: [{ id: 'space-sales', workspace_id: 7, visibility: 'workspace' }] satisfies Rows<'spaces'>,
    space_members: [],
    engine_pool: [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', host_id: 'host-01', box_index: 1, claimed_by_workspace_id: 7 }] satisfies Rows<'engine_pool'>,
    remote_computers: remoteComputers,
    oauth_pending_grants: pendingGrants(),
})

const registry = (): ServiceRegistry => ({
    services: {
        stripe: { status: 'active', config: {}, authMethodId: 'api-key', mcpServers: ['stripe'], envKeys: ['RERUN_SVC_STRIPE_STRIPE_SECRET_KEY'], skills: [], installedAt: '2026-11-10T09:00:00.000Z' },
        linear: { status: 'needs_auth', config: {}, authMethodId: 'oauth', mcpServers: ['linear'], envKeys: [], skills: [], oauth: { serverName: 'linear', url: 'https://mcp.linear.app/mcp' }, installedAt: '2026-11-18T16:20:00.000Z' },
    },
})

const scout = agentDetailSchema.parse({
    id: ENGINE_AGENT_ID,
    soul: 'You find leads in Lyon.',
    config: {
        name: ENGINE_AGENT_ID,
        mcpServers: [
            { name: 'rerun', transport: 'http', url: 'https://app.rerun.build/api/hub/mcp' },
            { name: 'stripe', transport: 'http', url: 'https://mcp.stripe.com', headers: { Authorization: 'Bearer ${RERUN_SVC_STRIPE_STRIPE_SECRET_KEY}' } },
            { name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp' },
            { name: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp' },
            { name: 'local-files', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/rerun'] },
        ],
    },
})

const settings = { mode: 'remember', unattended: true, allowedPrograms: ['git'], allowedFolders: ['/Users/ada/Projects'], screenAlways: false } satisfies RemoteComputerView['settings']

const studioView: RemoteComputerView = { id: STUDIO_MAC, handle: 'studio-mac', name: 'Studio Mac', online: true, paused: false, connectedAt: '2026-11-19T08:00:00.000Z', lastSeenAt: '2026-11-19T08:40:00.000Z', appVersion: '1.4.1', protocol: 3, capabilities: ['shell', 'files', 'jobs', 'screen'], facts: null, settings, runningJobs: 1 }
const officeView: RemoteComputerView = { ...studioView, id: OFFICE_PC, handle: 'office-pc', name: 'Office PC', online: false, connectedAt: null, lastSeenAt: '2026-11-12T17:05:00.000Z', appVersion: '1.3.2', capabilities: ['shell', 'files'], runningJobs: 0 }

const statuses = (entries: Record<string, McpServerStatus['status']>): McpServerStatus[] => Object.entries(entries).map(([name, status]) => ({ name, status, transport: 'http', toolCount: status === 'connected' ? 12 : 0 }))

// The registry the hub last wrote to the box, read back from the file it sent.
function writtenRegistry(): ServiceRegistry {
    const call = engine.writeFileText.mock.calls.at(-1)
    if (!call) throw new Error('the registry was never written')
    return JSON.parse(call[3]) as ServiceRegistry
}

const users: Record<string, { id: string; email: string; user_metadata: Record<string, string> }> = {
    'user-ada': { id: 'user-ada', email: 'ada@atelier-nord.fr', user_metadata: { full_name: 'Ada Lovelace' } },
}

beforeEach(() => {
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'contract-test-secret')
    const db = fakeSupabase(tableResolver(tables()))
    Object.assign(db.client, { auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ?? null } }) } } })
    state.db = db
    state.ctx = contractContext(db)

    for (const fn of [...Object.values(engine), ...Object.values(remote)]) fn.mockReset()
    engine.getAgent.mockResolvedValue(scout)
    engine.getMcpServerStatuses.mockImplementation(async (_conn, _agent, names) => statuses({ stripe: 'connected', linear: 'needs_auth', notion: 'needs_auth' }).filter(entry => names.includes(entry.name)))
    engine.readFileText.mockImplementation(async (_conn, _base, path) => ({ path, content: JSON.stringify(registry()) }))
    engine.writeFileText.mockResolvedValue(undefined)
    engine.makeDir.mockResolvedValue(undefined)
    engine.supportsVault.mockResolvedValue(false)
    engine.putMcpToken.mockResolvedValue(undefined)
    engine.updateAgentKeys.mockImplementation(async (_conn, _agent, body) => Object.keys(body.set ?? {}))
    engine.patchMcpServers.mockResolvedValue(scout)
    engine.supportsRemoteComputers.mockResolvedValue(true)
    remote.listRemoteComputers.mockResolvedValue([studioView, officeView])
    remote.upsertRemoteComputer.mockImplementation(async (_conn, id) => (id === OFFICE_PC ? officeView : studioView))
    remote.addRemoteComputerRule.mockImplementation(async (_conn, _id, rule) => ({ ...studioView, settings: { ...settings, allowedPrograms: rule.kind === 'program' ? [...settings.allowedPrograms, rule.program] : settings.allowedPrograms } }))
})

describe('a server the coworker registered outside the catalog', () => {
    it('describes the server it asks to be signed in to, drawn like the catalog draws its brand', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/mcp/[name]/route')
        const view = await expectContract(mobileApi.getMcpServer, await callRoute(GET, mobileApi.getMcpServer, { params: { id: AGENT_ID, name: 'notion' } }))
        expect(view).toEqual({ name: 'notion', displayName: 'Notion', host: 'mcp.notion.com', icon: 'https://cdn.rerun.build/services/notion.svg', status: 'needs_auth', canSignIn: true })
    })

    it('answers 404 for a server the coworker does not hold, nor one an app of the catalog owns', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/mcp/[name]/route')
        for (const name of ['sentry', 'linear']) {
            const res = await callRoute(GET, mobileApi.getMcpServer, { params: { id: AGENT_ID, name } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.getMcpServer, res, 404)
        }
    })

    it('opens its sign-in through a ticket that ends in the app', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/connect/route')
        const target = (await expectContract(mobileApi.connectMcpServer, await callRoute(POST, mobileApi.connectMcpServer, { params: { id: AGENT_ID, name: 'notion' } }))) as { url: string; returnUrl: string }
        expect(target.url).toMatch(/\/api\/oauth\/mobile\/start\?t=/)
        expect(target.returnUrl).toBe('rerun://oauth/callback')
    })

    it('refuses with a 409 a server whose sign-in cannot go through the browser', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/connect/route')
        const res = await callRoute(POST, mobileApi.connectMcpServer, { params: { id: AGENT_ID, name: 'local-files' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.connectMcpServer, res, 409)).toMatchObject({ error: expect.stringContaining('no sign-in') })
    })

    it('answers 404 to a sign-in for a coworker of another workspace', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/connect/route')
        const res = await callRoute(POST, mobileApi.connectMcpServer, { params: { id: '1d4e6f80-2a3b-4c5d-8e9f-0a1b2c3d4e5f', name: 'notion' } })
        expect(res.status).toBe(404)
        await expectContract(mobileApi.connectMcpServer, res, 404)
    })

    it('claims the parked sign-in and writes its token on the box', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/authorized/route')
        const res = await callRoute(POST, mobileApi.claimMcpSignIn, { params: { id: AGENT_ID, name: 'notion' }, body: { claim: 'claim-notion' } })
        await expectContract(mobileApi.claimMcpSignIn, res)
        expect(engine.putMcpToken).toHaveBeenCalledWith(expect.anything(), ENGINE_AGENT_ID, 'notion', expect.objectContaining({ accessToken: 'ntn_at_9f2c', refreshToken: 'ntn_rt_41ab' }))
    })

    it('refuses with a 409 a claim parked for another server, and writes nothing', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/authorized/route')
        const res = await callRoute(POST, mobileApi.claimMcpSignIn, { params: { id: AGENT_ID, name: 'notion' }, body: { claim: 'claim-linear' } })
        expect(res.status).toBe(409)
        await expectContract(mobileApi.claimMcpSignIn, res, 409)
        expect(engine.putMcpToken).not.toHaveBeenCalled()
    })

    it('refuses with a 409 a claim that expired or was already spent', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/authorized/route')
        const res = await callRoute(POST, mobileApi.claimMcpSignIn, { params: { id: AGENT_ID, name: 'notion' }, body: { claim: 'claim-gone' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.claimMcpSignIn, res, 409)).toMatchObject({ error: 'Sign-in expired, please retry' })
    })

    it('answers 400 to a claim without its row', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/mcp/[name]/authorized/route')
        const res = await callRoute(POST, mobileApi.claimMcpSignIn, { params: { id: AGENT_ID, name: 'notion' }, body: {} })
        expect(res.status).toBe(400)
        await expectContract(mobileApi.claimMcpSignIn, res, 400)
    })
})

describe('the apps of the catalog on a coworker', () => {
    it('resolves the cards of an app-setup block in the order the coworker suggested them', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/resolve/route')
        const body = { services: [{ slug: 'linear', reason: 'To file the bugs Ada reports' }, { slug: 'stripe' }, { slug: 'hubspot-pro', reason: 'An app it made up' }] }
        const cards = (await expectContract(mobileApi.resolveServices, await callRoute(POST, mobileApi.resolveServices, { params: { id: AGENT_ID }, body }))) as { slug: string; installStatus: string | null; pendingAuth: string | null; notFound: boolean; reason?: string; icon: string | null }[]
        expect(cards.map(card => [card.slug, card.installStatus, card.pendingAuth, card.notFound])).toEqual([
            ['linear', 'needs_auth', 'oauth', false],
            ['stripe', 'active', null, false],
            ['hubspot-pro', null, null, true],
        ])
        expect(cards[0]).toMatchObject({ reason: 'To file the bugs Ada reports', icon: 'https://cdn.rerun.build/services/linear.svg' })
    })

    it('answers 400 to an empty block', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/resolve/route')
        const res = await callRoute(POST, mobileApi.resolveServices, { params: { id: AGENT_ID }, body: { services: [] } })
        expect(res.status).toBe(400)
        await expectContract(mobileApi.resolveServices, res, 400)
    })

    it('reads one app with the coworker’s own install of it', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/services/[slug]/route')
        const card = await expectContract(mobileApi.getService, await callRoute(GET, mobileApi.getService, { params: { id: AGENT_ID, slug: 'stripe' } }))
        expect(card).toMatchObject({ slug: 'stripe', name: 'Stripe', installStatus: 'active', installedMethodId: 'api-key', verified: true, notFound: false, authMethods: [{ id: 'api-key', kind: 'key', requiresSecrets: true }] })
    })

    it('answers 404 for an app the catalog does not have', async () => {
        const { GET } = await import('@/app/api/v1/agents/[id]/services/[slug]/route')
        const res = await callRoute(GET, mobileApi.getService, { params: { id: AGENT_ID, slug: 'hubspot-pro' } })
        expect(res.status).toBe(404)
        await expectContract(mobileApi.getService, res, 404)
    })

    it('installs an app from its key, its server and its secret written on the box', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/install/route')
        const body = { values: { STRIPE_SECRET_KEY: 'rk_live_51NzQ8aKx0' }, authMethodId: 'api-key' }
        const result = await expectContract(mobileApi.installService, await callRoute(POST, mobileApi.installService, { params: { id: AGENT_ID, slug: 'stripe' }, body }))
        expect(result).toMatchObject({ status: 'installed', key: 'stripe', slug: 'stripe', name: 'Stripe', toolNames: ['stripe'] })
        expect(engine.updateAgentKeys).toHaveBeenCalledWith(expect.anything(), ENGINE_AGENT_ID, { set: { RERUN_SVC_STRIPE_STRIPE_SECRET_KEY: 'rk_live_51NzQ8aKx0' } })
        expect(writtenRegistry().services.stripe).toMatchObject({ status: 'active', authMethodId: 'api-key' })
    })

    it('installs an app behind a sign-in with the sign-in URL already minted', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/install/route')
        const result = await expectContract(mobileApi.installService, await callRoute(POST, mobileApi.installService, { params: { id: AGENT_ID, slug: 'notion' }, body: {} }))
        expect(result).toMatchObject({ status: 'needs_auth', key: 'notion', slug: 'notion', name: 'Notion', pendingAuth: 'oauth', connectUrl: expect.stringMatching(/\/api\/oauth\/mobile\/start\?t=/) })
        expect(result).not.toHaveProperty('oauth')
        expect(writtenRegistry().services.notion).toMatchObject({ status: 'needs_auth', oauth: { serverName: 'notion', url: 'https://mcp.notion.com/mcp' } })
    })

    it('asks for the form again when the key is missing', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/install/route')
        const result = await expectContract(mobileApi.installService, await callRoute(POST, mobileApi.installService, { params: { id: AGENT_ID, slug: 'stripe' }, body: { values: {} } }))
        expect(result).toMatchObject({ status: 'needs_config', authMethodId: 'api-key', authMethods: [{ id: 'api-key' }] })
    })

    it('refuses with a 422 a key the app turns down, and sends it back to its form', async () => {
        engine.getMcpServerStatuses.mockResolvedValue(statuses({ stripe: 'needs_auth' }))
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/install/route')
        const res = await callRoute(POST, mobileApi.installService, { params: { id: AGENT_ID, slug: 'stripe' }, body: { values: { STRIPE_SECRET_KEY: 'rk_live_wrong' } } })
        expect(res.status).toBe(422)
        expect(await expectContract(mobileApi.installService, res, 422)).toMatchObject({ code: 'serviceKeyRejected' })
    })

    it('opens the sign-in of an app waiting on it', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/connect/route')
        const target = (await expectContract(mobileApi.connectService, await callRoute(POST, mobileApi.connectService, { params: { id: AGENT_ID, slug: 'linear' } }))) as { url: string; returnUrl: string }
        expect(target.url).toMatch(/\/api\/oauth\/mobile\/start\?t=/)
        expect(target.returnUrl).toBe('rerun://oauth/callback')
    })

    it('answers 404 to the sign-in of a coworker of another workspace', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/connect/route')
        const res = await callRoute(POST, mobileApi.connectService, { params: { id: '1d4e6f80-2a3b-4c5d-8e9f-0a1b2c3d4e5f', slug: 'linear' } })
        expect(res.status).toBe(404)
        await expectContract(mobileApi.connectService, res, 404)
    })

    it('claims the parked sign-in, writes the token and flips the app to active', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/authorized/route')
        await expectContract(mobileApi.claimServiceSignIn, await callRoute(POST, mobileApi.claimServiceSignIn, { params: { id: AGENT_ID, slug: 'linear' }, body: { claim: 'claim-linear' } }))
        expect(engine.putMcpToken).toHaveBeenCalledWith(expect.anything(), ENGINE_AGENT_ID, 'linear', expect.objectContaining({ accessToken: 'lin_oauth_7d1e' }))
        expect(writtenRegistry().services.linear.status).toBe('active')
    })

    it('refuses with a 409 a claim that expired or was already spent', async () => {
        const { POST } = await import('@/app/api/v1/agents/[id]/services/[slug]/authorized/route')
        const res = await callRoute(POST, mobileApi.claimServiceSignIn, { params: { id: AGENT_ID, slug: 'linear' }, body: { claim: 'claim-gone' } })
        expect(res.status).toBe(409)
        await expectContract(mobileApi.claimServiceSignIn, res, 409)
        expect(engine.putMcpToken).not.toHaveBeenCalled()
    })
})

describe('the computers of the workspace', () => {
    it('lists the computers with what their box says of them now', async () => {
        const { GET } = await import('@/app/api/v1/computers/route')
        const res = await callRoute(GET, mobileApi.listComputers)
        const sent = (await res.clone().json()) as { engine: string; computers: Record<string, unknown>[] }
        expect(await expectContract(mobileApi.listComputers, res)).toEqual({
            computers: [
                { id: STUDIO_MAC, name: 'Studio Mac', handle: 'studio-mac', status: 'busy' },
                { id: OFFICE_PC, name: 'Office PC', handle: 'office-pc', status: 'offline' },
            ],
        })
        expect(sent.engine).toBe('ok')
        expect(sent.computers[0]).toMatchObject({ os: 'mac', canManage: true, runningJobs: 1, linkedBy: { id: 'user-ada', name: 'Ada Lovelace' } })
    })

    it('lists none to a visitor without an account', async () => {
        const { GET } = await import('@/app/api/v1/computers/route')
        state.ctx = contractContext(state.db as FakeSupabase, { authUser: { id: 'user-anon', email: undefined, is_anonymous: true, user_metadata: {}, app_metadata: {} } as WorkspaceContext['authUser'] })
        expect(await expectContract(mobileApi.listComputers, await callRoute(GET, mobileApi.listComputers))).toEqual({ computers: [] })
        expect(remote.listRemoteComputers).not.toHaveBeenCalled()
    })

    it('writes an "always allow" on the computer before the answer goes out', async () => {
        const { POST } = await import('@/app/api/v1/computers/[id]/rules/route')
        await expectContract(mobileApi.allowOnComputer, await callRoute(POST, mobileApi.allowOnComputer, { params: { id: STUDIO_MAC }, body: { kind: 'program', program: 'ffmpeg' } }))
        expect(remote.addRemoteComputerRule).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: expect.any(String) }), STUDIO_MAC, { kind: 'program', program: 'ffmpeg' })
    })

    it('refuses with a 422 a computer no longer linked to the workspace', async () => {
        const { POST } = await import('@/app/api/v1/computers/[id]/rules/route')
        const res = await callRoute(POST, mobileApi.allowOnComputer, { params: { id: 'f3b1c2d4-0000-4e5f-9a8b-7c6d5e4f3a21' }, body: { kind: 'screen' } })
        expect(res.status).toBe(422)
        expect(await expectContract(mobileApi.allowOnComputer, res, 422)).toMatchObject({ code: 'computerNotFound' })
        expect(remote.addRemoteComputerRule).not.toHaveBeenCalled()
    })

    it('answers 400 to a rule the computer cannot hold', async () => {
        const { POST } = await import('@/app/api/v1/computers/[id]/rules/route')
        const res = await callRoute(POST, mobileApi.allowOnComputer, { params: { id: STUDIO_MAC }, body: { kind: 'program', program: '' } })
        expect(res.status).toBe(400)
        await expectContract(mobileApi.allowOnComputer, res, 400)
    })
})
