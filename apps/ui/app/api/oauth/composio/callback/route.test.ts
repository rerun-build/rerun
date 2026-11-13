import { loadManifest, markComposioAuthorized } from '@/app/api/_services/services.service'
import { type ComposioConnectedAccount, getConnectedAccount } from '@/lib/composio/client'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { type ComposioOAuthContext, encodeComposioContext } from '@/lib/composio/oauth'
import { mintCallbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { cookies } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ requireAgentWorkspaceId: vi.fn(async () => 7), workspaceActor: (workspaceId: number) => ({ kind: 'workspace', workspaceId }) }))
vi.mock('@/app/api/_services/services.service', () => ({ markComposioAuthorized: vi.fn(), loadManifest: vi.fn() }))
vi.mock('@/lib/oauth/pending-grant', () => ({ parkSignIn: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn(async () => ({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-agent' })) }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(async () => ({ services: {} })) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/lib/composio/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/composio/client')>()), getConnectedAccount: vi.fn() }))

const STATE = 'state-1'
const COOKIE = `composio_oauth_${STATE}`

const CONTEXT: ComposioOAuthContext = {
    agentId: 'agent-1',
    key: 'gmail',
    toolkit: 'gmail',
    serverName: 'gmail',
    connectedAccountId: 'ca_1',
}

const MANIFEST = serviceManifestSchema.parse({
    slug: 'gmail',
    name: 'Gmail',
    authMethods: [{ id: 'composio', kind: 'composio', composio: { toolkit: 'gmail', authConfigId: 'ac_gmail' }, mcpServers: [{ name: 'gmail', transport: 'http', url: 'https://rerun.test/api/mcp/composio/gmail' }] }],
})

const ACTIVE: ComposioConnectedAccount = { id: 'ca_1', userId: 'local_agent_agent-1', authConfigId: 'ac_gmail', status: 'ACTIVE', toolkit: 'gmail' }

let jar: Record<string, string> = {}

async function callback(params: Record<string, string>) {
    const pending = GET(new Request(`https://rerun.test/api/oauth/composio/callback?${new URLSearchParams(params)}`))
    await vi.runAllTimersAsync()
    return pending
}

function withContext(ctx: ComposioOAuthContext) {
    jar = { [COOKIE]: encodeComposioContext(ctx) }
}

function deletesStateCookie(res: Response) {
    const header = res.headers.get('set-cookie') ?? ''
    return header.includes(`${COOKIE}=;`) && header.includes('Path=/api/oauth/composio') && header.includes('Expires=Thu, 01 Jan 1970')
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.stubEnv('COMPOSIO_USER_NAMESPACE', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    jar = {}
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (jar[name] === undefined ? undefined : { name, value: jar[name] }) } as never)
    vi.mocked(getConnectedAccount).mockResolvedValue(ACTIVE)
    vi.mocked(loadManifest).mockResolvedValue(MANIFEST)
    vi.mocked(readRegistry).mockResolvedValue({ services: {} })
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe('GET /api/oauth/composio/callback', () => {
    it('marks the service connected once the account is verified active', async () => {
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('composio-oauth-success')
        expect(getConnectedAccount).toHaveBeenCalledWith('ca_1')
        expect(markComposioAuthorized).toHaveBeenCalledWith('agent-1', 'gmail', 'ca_1', undefined, { kind: 'workspace', workspaceId: 7 })
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('marks the extra account it was started for and names it in the popup message', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, userId: 'local_agent_agent-1_k3x9ab' })
        withContext({ ...CONTEXT, key: 'gmail@k3x9ab' })

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('"key":"gmail@k3x9ab"')
        expect(markComposioAuthorized).toHaveBeenCalledWith('agent-1', 'gmail@k3x9ab', 'ca_1', undefined, { kind: 'workspace', workspaceId: 7 })
    })

    it('refuses an extra account whose Composio user is the base account of the agent', async () => {
        withContext({ ...CONTEXT, key: 'gmail@k3x9ab' })

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection mismatch')
        expect(markComposioAuthorized).not.toHaveBeenCalled()
    })

    it('refuses a callback without a state', async () => {
        const res = await callback({ status: 'success' })

        expect(await res.text()).toContain('Missing state')
        expect(markComposioAuthorized).not.toHaveBeenCalled()
    })

    it('refuses a forged context cookie without checking the account', async () => {
        jar = { [COOKIE]: Buffer.from(JSON.stringify({ ...CONTEXT, agentId: 'agent-of-a-victim' })).toString('base64') }

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('asks to retry when the state cookie is gone, and still clears it', async () => {
        const res = await callback({ state: STATE })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('reports a refused sign-in without checking the account', async () => {
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'failed', error: 'user_cancelled' })

        expect(await res.text()).toContain('Authorization failed: user_cancelled')
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('renders a hostile status as text', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: '</script><img src=x onerror=alert(1)>' })
        const body = await res.text()

        expect(body).not.toContain('<img')
        expect(body).toContain('Authorization failed: Connection &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    })

    it('marks nothing when the account belongs to another Composio user', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, userId: 'local_agent_agent-2' })
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection mismatch, please retry')
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('marks nothing when the account was made with another auth config', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, authConfigId: 'ac_other' })
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection mismatch, please retry')
        expect(markComposioAuthorized).not.toHaveBeenCalled()
    })

    it('polls a pending account until it turns active', async () => {
        vi.mocked(getConnectedAccount)
            .mockResolvedValueOnce({ ...ACTIVE, status: 'INITIALIZING' })
            .mockResolvedValueOnce({ ...ACTIVE, status: 'INITIATED' })
            .mockResolvedValueOnce(ACTIVE)
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('composio-oauth-success')
        expect(getConnectedAccount).toHaveBeenCalledTimes(3)
        expect(markComposioAuthorized).toHaveBeenCalledOnce()
    })

    it('gives up with an error when the account never turns active', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, status: 'INITIALIZING' })
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection is not active yet (INITIALIZING). Please retry.')
        expect(getConnectedAccount).toHaveBeenCalledTimes(5)
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('stops polling as soon as the account has failed', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, status: 'FAILED' })
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection is not active yet (FAILED)')
        expect(getConnectedAccount).toHaveBeenCalledOnce()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
    })

    it('sends a forged mobile grant back to the app as an error without marking anything', async () => {
        withContext({ ...CONTEXT, mobileGrant: 'forged.signature' })

        const res = await callback({ state: STATE, status: 'success' })

        expect(res.status).toBe(302)
        const location = new URL(res.headers.get('location') ?? '')
        expect(location.protocol).toBe('rerun:')
        expect(location.searchParams.get('message')).toBe('Invalid sign-in grant')
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('parks the checked account of a valid mobile grant for the app to claim, and marks nothing yet', async () => {
        withContext({ ...CONTEXT, mobileGrant: mintCallbackGrant({ agentId: CONTEXT.agentId, workspaceId: 7, userId: 'user-1', jti: 'row-1' }) })

        const res = await callback({ state: STATE, status: 'success' })

        const location = new URL(res.headers.get('location') ?? '')
        expect(location.searchParams.get('status')).toBe('success')
        expect(location.searchParams.get('claim')).toBe('row-1')
        expect(getConnectedAccount).toHaveBeenCalled()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(parkSignIn).toHaveBeenCalledWith(expect.objectContaining({ jti: 'row-1', workspaceId: 7 }), { kind: 'composio', key: 'gmail', connectedAccountId: 'ca_1' })
    })

    it('re-derives the Composio user id from the agent id instead of trusting the userId in the unsigned base64 cookie', async () => {
        vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, userId: 'local_agent_victim' })
        withContext({ ...CONTEXT, userId: 'local_agent_victim', authConfigId: 'ac_gmail' } as ComposioOAuthContext)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('Connection mismatch, please retry')
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    describe('for an account the Vault lends', () => {
        const FOREIGN_USER = 'local_agent_99999999-9999-4999-8999-999999999999'
        const lent = { status: 'active' as const, config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '', vaultItemId: 'item-1' }

        beforeEach(() => {
            vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: lent } })
            vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1', composio: { toolkit: 'gmail', serverName: 'gmail', userId: FOREIGN_USER } } as never)
            withContext(CONTEXT)
        })

        it("accepts the account connected under the entry's own user of the workspace", async () => {
            vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, userId: 'local_vault_7_item-1' })

            const res = await callback({ state: STATE, status: 'success' })

            expect(await res.text()).toContain('composio-oauth-success')
            expect(markComposioAuthorized).toHaveBeenCalledOnce()
        })

        it('refuses an account connected under the user the box names, when it is not of the workspace', async () => {
            vi.mocked(getConnectedAccount).mockResolvedValue({ ...ACTIVE, userId: FOREIGN_USER })

            const res = await callback({ state: STATE, status: 'success' })

            expect(await res.text()).toContain('Connection mismatch, please retry')
            expect(markComposioAuthorized).not.toHaveBeenCalled()
        })
    })

    it('refuses a slug whose manifest has no Composio connection', async () => {
        vi.mocked(loadManifest).mockResolvedValue(serviceManifestSchema.parse({ slug: 'gmail', name: 'Gmail' }))
        withContext(CONTEXT)

        const res = await callback({ state: STATE, status: 'success' })

        expect(await res.text()).toContain('gmail has no Composio connection to set up.')
        expect(getConnectedAccount).not.toHaveBeenCalled()
        expect(markComposioAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })
})
