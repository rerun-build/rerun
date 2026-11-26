import { getServiceDetails, loadManifest } from '@/app/api/_services/services.service'
import { composioUserId, composioVaultOwnUserId, deleteConnectedAccount, initiateConnectedAccount } from '@/lib/composio/client'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { decodeComposioContext } from '@/lib/composio/oauth'
import { decodeManagedContext } from '@/lib/managed/oauth'
import { decodeContext } from '@/lib/mcp-oauth'
import { callbackGrant, mintConnectTicket } from '@/lib/oauth/mobile-ticket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCustomMcpServer = vi.fn()
const openPendingGrant = vi.fn()
const purgeExpiredGrants = vi.fn()
const resolveClient = vi.fn<typeof import('@/lib/mcp-oauth').resolveClient>()
let afterTasks: Promise<unknown>[] = []
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: (task: () => Promise<unknown>) => void afterTasks.push(task()) }))
vi.mock('@/lib/oauth/pending-grant', () => ({ openPendingGrant: (...args: unknown[]) => openPendingGrant(...args), purgeExpiredGrants: () => purgeExpiredGrants() }))
vi.mock('@/app/api/_services/custom-mcp.service', () => ({ getCustomMcpServer: (...args: unknown[]) => getCustomMcpServer(...args) }))
vi.mock('@/app/api/_services/services.service', () => ({ getServiceDetails: vi.fn(), loadManifest: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(async () => ({ services: {} })) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/vault.service', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_services/vault.service')>()),
    vaultContext: vi.fn(async (actor: unknown) => ({ actor, conn: { baseUrl: 'https://engine.test', apiKey: null }, coworkers: [], byEngineId: new Map() })),
}))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), composioConfigured: () => true, deleteConnectedAccount: vi.fn(), initiateConnectedAccount: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_services/workspace-engine.service')>()), findWorkspaceEngine: vi.fn(async () => null) }))
vi.mock('@/lib/mcp-oauth', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/mcp-oauth')>()),
    discoverAuthServer: async () => ({ authorizationEndpoint: 'https://linear.app/oauth/authorize', tokenEndpoint: 'https://linear.app/oauth/token', scopesSupported: ['read'], resource: 'https://mcp.linear.app/mcp' }),
    resolveClient: (...args: Parameters<typeof resolveClient>) => resolveClient(...args),
}))

const { GET } = await import('./route')

const open = (ticket: string) => GET(new Request(`https://app.rerun.build/api/oauth/mobile/start?t=${encodeURIComponent(ticket)}`, { headers: { host: 'app.rerun.build', 'x-forwarded-proto': 'https' } }))
const serverTicket = () => mintConnectTicket({ agentId: 'agent-1', server: 'linear', workspaceId: 7, userId: 'user-1' })

beforeEach(() => {
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    afterTasks = []
    openPendingGrant.mockReset().mockResolvedValue(undefined)
    purgeExpiredGrants.mockReset().mockResolvedValue([])
    resolveClient.mockReset().mockResolvedValue({ clientId: 'client-1' })
    getCustomMcpServer.mockReset().mockResolvedValue({ server: { name: 'linear', displayName: 'Linear', transport: 'http', host: 'mcp.linear.app', icon: null, signInUrl: 'https://mcp.linear.app/mcp' }, status: 'needs_auth' })
})

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/oauth/mobile/start, for a server registered outside the catalog', () => {
    it('reads the server off the agent and sends the browser to its sign-in, the callback bound to the app', async () => {
        const res = await open(serverTicket())
        expect(res.status).toBe(302)
        expect(new URL(res.headers.get('location')!).origin).toBe('https://linear.app')
        expect(getCustomMcpServer).toHaveBeenCalledWith('agent-1', 'linear', { kind: 'workspace', workspaceId: 7 })
        const [cookie] = res.cookies.getAll()
        expect(decodeContext(cookie.value)).toMatchObject({ agentId: 'agent-1', serverName: 'linear', mcpUrl: 'https://mcp.linear.app/mcp', resource: 'https://mcp.linear.app/mcp', mobileGrant: expect.any(String) })
    })

    it('spends the ticket as the sign-in starts, and refuses a second start on it', async () => {
        const ticket = serverTicket()
        await open(ticket)
        expect(openPendingGrant).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1', workspaceId: 7, userId: 'user-1', jti: expect.any(String) }))

        openPendingGrant.mockRejectedValueOnce(new Error('This sign-in link was already used, please retry'))
        const res = await open(ticket)
        const location = new URL(res.headers.get('location')!)
        expect(location.protocol).toBe('rerun:')
        expect(location.searchParams.get('status')).toBe('error')
        expect(location.searchParams.get('message')).toContain('already used')
        expect(getCustomMcpServer).toHaveBeenCalledTimes(1)
    })

    it('ends in the app with the reason when the server has no browser sign-in', async () => {
        getCustomMcpServer.mockResolvedValue(null)
        const res = await open(serverTicket())
        const location = new URL(res.headers.get('location')!)
        expect(`${location.protocol}//${location.host}${location.pathname}`).toBe('rerun://oauth/callback')
        expect(location.searchParams.get('status')).toBe('error')
    })
})

describe('GET /api/oauth/mobile/start, and the sign-ins nobody claimed', () => {
    it('drops the accounts they left, and starts this one whatever becomes of them', async () => {
        purgeExpiredGrants.mockResolvedValueOnce([
            { workspaceId: 7, itemId: 'item-1', connectedAccountId: 'ca_1' },
            { workspaceId: 8, itemId: 'item-2', connectedAccountId: 'ca_2' },
        ])
        expect((await open(serverTicket())).status).toBe(302)
        await Promise.all(afterTasks)
        expect(vi.mocked(deleteConnectedAccount).mock.calls).toEqual([['ca_1'], ['ca_2']])

        vi.spyOn(console, 'warn').mockImplementation(() => {})
        purgeExpiredGrants.mockRejectedValueOnce(new Error('db down'))
        expect(new URL((await open(serverTicket())).headers.get('location')!).origin).toBe('https://linear.app')
        await Promise.all(afterTasks)
    })

    it('purges nothing for a ticket that does not verify', async () => {
        await open('forged')
        expect(purgeExpiredGrants).not.toHaveBeenCalled()
    })
})

describe('GET /api/oauth/mobile/start, for an entry of the Vault', () => {
    const vaultTicket = () => mintConnectTicket({ agentId: '', vaultItem: 'item-1', workspaceId: 7, userId: 'user-1', desktop: 'stable' })

    it("reads the entry's server off the Vault and leaves the context cookie in this browser, bound to the entry", async () => {
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', oauth: { serverName: 'notion', url: 'https://mcp.notion.com/mcp' } } as never)

        const res = await open(vaultTicket())

        expect(res.status).toBe(302)
        expect(new URL(res.headers.get('location')!).origin).toBe('https://linear.app')
        expect(getVaultItem).toHaveBeenCalledWith({ baseUrl: 'https://engine.test', apiKey: null }, 'item-1')
        const [cookie] = res.cookies.getAll()
        expect(cookie.name).toMatch(/^mcp_oauth_/)
        const ctx = decodeContext(cookie.value)
        expect(ctx).toMatchObject({ agentId: '', serverName: 'notion', mcpUrl: 'https://mcp.notion.com/mcp', vault: { itemId: 'item-1', workspaceId: 7 } })
        expect(callbackGrant(ctx)).toMatchObject({ vaultItem: 'item-1', workspaceId: 7, userId: 'user-1', desktop: 'stable' })
    })

    it("signs a WordPress.com entry in through Rerun's own app on the OAuth 2 endpoints, the secret kept on the hub", async () => {
        const actual = await vi.importActual<typeof import('@/lib/mcp-oauth')>('@/lib/mcp-oauth')
        resolveClient.mockImplementation(actual.resolveClient)
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_ID', 'wpcom-app')
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_SECRET', 'wpcom-secret')
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', oauth: { serverName: 'wordpress', url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' } } as never)

        const res = await open(vaultTicket())

        const authorize = new URL(res.headers.get('location')!)
        expect(authorize.origin + authorize.pathname).toBe('https://public-api.wordpress.com/oauth2/authorize')
        expect(authorize.searchParams.get('client_id')).toBe('wpcom-app')
        expect(authorize.searchParams.get('scope')).toBe('global')
        const ctx = decodeContext(res.cookies.getAll()[0].value)
        expect(ctx).toMatchObject({ clientId: 'wpcom-app', tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token', vault: { itemId: 'item-1', workspaceId: 7 } })
        expect(ctx.clientSecret).toBeUndefined()
    })

    it("starts a Composio entry as the entry's own user, bound to the entry and to the app", async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', slug: 'gmail', name: 'Gmail', composio: { toolkit: 'gmail', serverName: 'gmail' } } as never)
        vi.mocked(loadManifest).mockResolvedValue({ name: 'Gmail', authMethods: [{ kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_1' } }] } as unknown as Awaited<ReturnType<typeof loadManifest>>)
        vi.mocked(initiateConnectedAccount).mockResolvedValue({ connectedAccountId: 'ca_2', redirectUrl: 'https://connect.composio.dev/link/x' })

        const res = await open(vaultTicket())

        expect(res.headers.get('location')).toBe('https://connect.composio.dev/link/x')
        expect(initiateConnectedAccount).toHaveBeenLastCalledWith(composioVaultOwnUserId(7, 'item-1'), 'ac_1', expect.any(String))
        const ctx = decodeComposioContext(res.cookies.getAll()[0].value)
        expect(ctx).toMatchObject({ agentId: '', key: 'item-1', vault: { itemId: 'item-1', workspaceId: 7 } })
        expect(callbackGrant(ctx)).toMatchObject({ vaultItem: 'item-1', workspaceId: 7, userId: 'user-1', desktop: 'stable' })
    })

    it('starts a managed entry with its provider', async () => {
        vi.stubEnv('RERUN_TYPEFORM_CLIENT_ID', 'tf-id')
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', slug: 'typeform', name: 'Typeform', managed: { provider: 'typeform', serverName: 'typeform' } } as never)

        const res = await open(vaultTicket())

        expect(new URL(res.headers.get('location')!).searchParams.get('client_id')).toBe('tf-id')
        const ctx = decodeManagedContext(res.cookies.getAll()[0].value)
        expect(ctx).toMatchObject({ agentId: '', key: 'item-1', provider: 'typeform', vault: { itemId: 'item-1', workspaceId: 7 } })
        expect(callbackGrant(ctx)).toMatchObject({ vaultItem: 'item-1', desktop: 'stable' })
    })

    it('ends in the desktop app with the reason when the entry has no sign-in', async () => {
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1' } as never)

        const res = await open(vaultTicket())

        const location = new URL(res.headers.get('location')!)
        expect(location.protocol).toBe('rerun-desktop:')
        expect(location.searchParams.get('status')).toBe('error')
        expect(res.cookies.getAll()).toEqual([])
    })
})

describe('GET /api/oauth/mobile/start, for an extra account of a Composio app', () => {
    const KEY = 'gmail@k3x9ab'

    beforeEach(() => {
        vi.mocked(getServiceDetails).mockResolvedValue({ name: 'Gmail', composio: { toolkit: 'gmail', serverName: 'gmail-k3x9ab' } } as Awaited<ReturnType<typeof getServiceDetails>>)
        vi.mocked(loadManifest).mockResolvedValue({ authMethods: [{ kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_1' } }] } as unknown as Awaited<ReturnType<typeof loadManifest>>)
        vi.mocked(initiateConnectedAccount).mockResolvedValue({ connectedAccountId: 'ca_2', redirectUrl: 'https://connect.composio.dev/link/x' })
    })

    it('connects the instance as its own Composio user and carries its registry key to the callback', async () => {
        const res = await open(mintConnectTicket({ agentId: 'agent-1', key: KEY, workspaceId: 7, userId: 'user-1' }))

        expect(res.headers.get('location')).toBe('https://connect.composio.dev/link/x')
        expect(getServiceDetails).toHaveBeenCalledWith('agent-1', KEY, { kind: 'workspace', workspaceId: 7 })
        expect(initiateConnectedAccount).toHaveBeenCalledWith(composioUserId('agent-1', 'k3x9ab'), 'ac_1', expect.any(String))
        const [cookie] = res.cookies.getAll()
        const ctx = decodeComposioContext(cookie.value)
        expect(ctx).toMatchObject({ agentId: 'agent-1', key: KEY, serverName: 'gmail-k3x9ab' })
        expect(ctx).not.toHaveProperty('userId')
    })

    it("connects an account the Vault lends as the entry's own user of the workspace, whatever user the box names", async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
        vi.mocked(readRegistry).mockResolvedValueOnce({ services: { [KEY]: { status: 'needs_auth', config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '', vaultItemId: 'item-1' } } })
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', composio: { toolkit: 'gmail', serverName: 'gmail-k3x9ab', userId: composioUserId('99999999-9999-4999-8999-999999999999') } } as never)

        await open(mintConnectTicket({ agentId: 'agent-1', key: KEY, workspaceId: 7, userId: 'user-1' }))

        expect(initiateConnectedAccount).toHaveBeenLastCalledWith(composioVaultOwnUserId(7, 'item-1'), 'ac_1', expect.any(String))
    })
})
