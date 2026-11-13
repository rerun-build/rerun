import { getServiceDetails, loadManifest } from '@/app/api/_services/services.service'
import { composioUserId, composioVaultOwnUserId, initiateConnectedAccount } from '@/lib/composio/client'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { decodeComposioContext } from '@/lib/composio/oauth'
import { decodeContext } from '@/lib/mcp-oauth'
import { mintConnectTicket } from '@/lib/oauth/mobile-ticket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getCustomMcpServer = vi.fn()
const openPendingGrant = vi.fn()
vi.mock('@/lib/oauth/pending-grant', () => ({ openPendingGrant: (...args: unknown[]) => openPendingGrant(...args) }))
vi.mock('@/app/api/_services/custom-mcp.service', () => ({ getCustomMcpServer: (...args: unknown[]) => getCustomMcpServer(...args) }))
vi.mock('@/app/api/_services/services.service', () => ({ getServiceDetails: vi.fn(), loadManifest: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(async () => ({ services: {} })) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), composioConfigured: () => true, initiateConnectedAccount: vi.fn() }))
vi.mock('@/lib/mcp-oauth', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/mcp-oauth')>()),
    discoverAuthServer: async () => ({ authorizationEndpoint: 'https://linear.app/oauth/authorize', tokenEndpoint: 'https://linear.app/oauth/token', scopesSupported: ['read'] }),
    resolveClient: async () => ({ clientId: 'client-1' }),
}))

const { GET } = await import('./route')

const open = (ticket: string) => GET(new Request(`https://app.rerun.build/api/oauth/mobile/start?t=${encodeURIComponent(ticket)}`, { headers: { host: 'app.rerun.build', 'x-forwarded-proto': 'https' } }))
const serverTicket = () => mintConnectTicket({ agentId: 'agent-1', server: 'linear', workspaceId: 7, userId: 'user-1' })

beforeEach(() => {
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    openPendingGrant.mockReset().mockResolvedValue(undefined)
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
        expect(decodeContext(cookie.value)).toMatchObject({ agentId: 'agent-1', serverName: 'linear', mcpUrl: 'https://mcp.linear.app/mcp', mobileGrant: expect.any(String) })
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
