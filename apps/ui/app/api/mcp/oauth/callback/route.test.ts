import { findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { putMcpToken } from '@/lib/engine/client'
import { type OAuthContext, encodeContext, exchangeCode } from '@/lib/mcp-oauth'
import { mintCallbackGrant } from '@/lib/oauth/mobile-ticket'
import { parkSignIn } from '@/lib/oauth/pending-grant'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { fakeSupabase } from '@/test/supabase-fake'
import { cookies } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = vi.fn()
    return { getServerSession: session, getSessionWorkspace: session }
})
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn(), findWorkspaceEngine: vi.fn(), NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/lib/engine/client', () => ({ putMcpToken: vi.fn(), listRuns: vi.fn() }))
vi.mock('@/lib/oauth/pending-grant', () => ({ parkSignIn: vi.fn() }))
vi.mock('@/lib/mcp-oauth', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/mcp-oauth')>()), exchangeCode: vi.fn() }))

const SESSION_WORKSPACE = 1
const OTHER_WORKSPACE = 2
const STATE = 'state-1'
const COOKIE = `mcp_oauth_${STATE}`

const CONTEXT: OAuthContext = {
    verifier: 'verifier',
    agentId: 'agent-1',
    serverName: 'acme',
    mcpUrl: 'https://mcp.acme.test/mcp',
    tokenEndpoint: 'https://auth.acme.test/token',
    clientId: 'client-1',
    redirectUri: 'https://rerun.test/api/mcp/oauth/callback',
}

let agentWorkspace = SESSION_WORKSPACE
let memberOfAgentWorkspace = true
let jar: Record<string, string> = {}

const GRANT = (patch: { agentId?: string } = {}) => mintCallbackGrant({ agentId: CONTEXT.agentId, workspaceId: SESSION_WORKSPACE, userId: 'user-1', jti: 'row-1', ...patch })

function callback(params: Record<string, string>) {
    return GET(new Request(`https://rerun.test/api/mcp/oauth/callback?${new URLSearchParams(params)}`))
}

function withContext(ctx: OAuthContext) {
    jar = { [COOKIE]: encodeContext(ctx) }
}

function deletesStateCookie(res: Response) {
    const header = res.headers.get('set-cookie') ?? ''
    return header.includes(`${COOKIE}=;`) && header.includes('Path=/api/mcp/oauth') && header.includes('Expires=Thu, 01 Jan 1970')
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    agentWorkspace = SESSION_WORKSPACE
    memberOfAgentWorkspace = true
    jar = {}
    const db = fakeSupabase(table => {
        if (table === 'agents') return { data: { workspace_id: agentWorkspace, engine_agent_id: 'engine-agent', template_id: null, disabled_at: null, disabled_reason: null, workspaces: { subscription_status: 'active', is_sandbox: false } } }
        if (table === 'workspace_members') return { data: memberOfAgentWorkspace ? { user_id: 'user-1' } : null }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1', workspace_id: SESSION_WORKSPACE }, workspaceRefused: false } as never)
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (jar[name] === undefined ? undefined : { name, value: jar[name] }) } as never)
    vi.mocked(getWorkspaceConnection).mockResolvedValue({ baseUrl: 'https://engine.test', apiKey: null })
    vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i1', conn: { baseUrl: 'https://engine.test', apiKey: null }, managed: true })
    vi.mocked(exchangeCode).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' })
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('GET /api/mcp/oauth/callback', () => {
    it('stores the token on the engine of the agent owned by the caller', async () => {
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        const html = await res.text()
        expect(html).toContain('mcp-oauth-success')
        expect(html).toContain('"serverName":"acme"')
        expect(putMcpToken).toHaveBeenCalledWith({ baseUrl: 'https://engine.test', apiKey: null }, 'engine-agent', 'acme', expect.objectContaining({ accessToken: 'access', refreshToken: 'refresh' }))
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('reports the error the provider sent back without exchanging anything', async () => {
        withContext(CONTEXT)

        const res = await callback({ error: 'access_denied', state: STATE })

        expect(await res.text()).toContain('Authorization failed: access_denied')
        expect(exchangeCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('renders a hostile provider error as text, before any cookie is read', async () => {
        const res = await callback({ error: '</script><img src=x onerror=alert(1)>' })
        const body = await res.text()

        expect(body).not.toContain('<img')
        expect(body).toContain('Authorization failed: &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    })

    it('refuses a callback without a code', async () => {
        withContext(CONTEXT)

        const res = await callback({ state: STATE })

        expect(await res.text()).toContain('Missing code or state')
        expect(exchangeCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('clears the state cookie when the provider answers with an error or no code', async () => {
        withContext(CONTEXT)

        expect(deletesStateCookie(await callback({ error: 'access_denied', state: STATE }))).toBe(true)
        expect(deletesStateCookie(await callback({ state: STATE }))).toBe(true)
        expect(exchangeCode).not.toHaveBeenCalled()
    })

    it('refuses a forged context cookie without exchanging the code', async () => {
        jar = { [COOKIE]: Buffer.from(JSON.stringify({ ...CONTEXT, agentId: 'agent-of-a-victim' })).toString('base64') }

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(exchangeCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('asks to retry when the state cookie is gone, and still clears it', async () => {
        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('writes no token for an agent of another workspace', async () => {
        agentWorkspace = OTHER_WORKSPACE
        memberOfAgentWorkspace = false
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Authorization failed: Coworker not found')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('stores the token for an agent of another workspace the caller belongs to, which a tab may be on', async () => {
        agentWorkspace = OTHER_WORKSPACE
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('mcp-oauth-success')
        expect(putMcpToken).toHaveBeenCalledOnce()
    })

    it('writes no token when the caller has no session', async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: null, workspaceRefused: false } as never)
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('mcp-oauth-error')
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('sends a forged mobile grant back to the app as an error without writing a token', async () => {
        withContext({ ...CONTEXT, mobileGrant: 'forged.signature' })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(res.status).toBe(302)
        const location = new URL(res.headers.get('location') ?? '')
        expect(location.protocol).toBe('rerun:')
        expect(location.searchParams.get('status')).toBe('error')
        expect(location.searchParams.get('message')).toBe('Invalid sign-in grant')
        expect(exchangeCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('refuses a mobile grant signed for a different agent', async () => {
        withContext({ ...CONTEXT, mobileGrant: GRANT({ agentId: 'agent-2' }) })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(new URL(res.headers.get('location') ?? '').searchParams.get('message')).toBe('Invalid sign-in grant')
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('writes no token when a valid mobile grant names a workspace that does not own the agent', async () => {
        agentWorkspace = OTHER_WORKSPACE
        withContext({ ...CONTEXT, mobileGrant: GRANT() })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(new URL(res.headers.get('location') ?? '').searchParams.get('status')).toBe('error')
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('parks the token of a valid mobile grant for the app to claim, and writes nothing on the engine', async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: null, workspaceRefused: false } as never)
        withContext({ ...CONTEXT, mobileGrant: GRANT() })

        const res = await callback({ code: 'code-1', state: STATE })

        const location = new URL(res.headers.get('location') ?? '')
        expect(location.searchParams.get('status')).toBe('success')
        expect(location.searchParams.get('claim')).toBe('row-1')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(parkSignIn).toHaveBeenCalledWith(expect.objectContaining({ jti: 'row-1', userId: 'user-1' }), { kind: 'mcp', serverName: 'acme', mcpUrl: CONTEXT.mcpUrl, token: expect.objectContaining({ accessToken: 'access', refreshToken: 'refresh', tokenEndpoint: CONTEXT.tokenEndpoint }) })
        expect(deletesStateCookie(res)).toBe(true)
    })

    describe('pre-registered Asana client', () => {
        const ASANA: OAuthContext = { ...CONTEXT, serverName: 'asana', mcpUrl: 'https://mcp.asana.com/v2/mcp', clientId: 'asana-id' }

        beforeEach(() => {
            vi.stubEnv('RERUN_ASANA_MCP_CLIENT_ID', 'asana-id')
            vi.stubEnv('RERUN_ASANA_MCP_CLIENT_SECRET', 'asana-secret')
        })

        it('hands the engine the secret on the web path', async () => {
            withContext(ASANA)

            await callback({ code: 'code-1', state: STATE })

            expect(putMcpToken).toHaveBeenCalledWith(expect.anything(), 'engine-agent', 'asana', expect.objectContaining({ accessToken: 'access', clientId: 'asana-id', clientSecret: 'asana-secret' }))
        })

        it('parks the mobile bundle without the secret, naming the MCP server for the claim to read it again', async () => {
            vi.mocked(getServerSession).mockResolvedValue({ user: null, workspaceRefused: false } as never)
            withContext({ ...ASANA, mobileGrant: GRANT() })

            await callback({ code: 'code-1', state: STATE })

            expect(parkSignIn).toHaveBeenCalledWith(expect.objectContaining({ jti: 'row-1' }), { kind: 'mcp', serverName: 'asana', mcpUrl: ASANA.mcpUrl, token: expect.objectContaining({ accessToken: 'access', clientId: 'asana-id' }) })
            expect(JSON.stringify(vi.mocked(parkSignIn).mock.calls[0][1])).not.toContain('asana-secret')
        })
    })

    it('parks the secret of a dynamically registered client, which belongs to that registration alone', async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: null, workspaceRefused: false } as never)
        withContext({ ...CONTEXT, clientSecret: 'dcr-secret', mobileGrant: GRANT() })

        await callback({ code: 'code-1', state: STATE })

        expect(parkSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ token: expect.objectContaining({ clientSecret: 'dcr-secret' }) }))
    })

    it('ends in the app with the reason when the row of the grant is gone', async () => {
        vi.mocked(parkSignIn).mockRejectedValueOnce(new Error('Sign-in expired, please retry'))
        withContext({ ...CONTEXT, mobileGrant: GRANT() })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(new URL(res.headers.get('location') ?? '').searchParams.get('message')).toBe('Sign-in expired, please retry')
        expect(putMcpToken).not.toHaveBeenCalled()
    })

    it('clears the state cookie when the token exchange fails', async () => {
        vi.mocked(exchangeCode).mockRejectedValue(new Error('token exchange failed (400)'))
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('token exchange failed (400)')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('checks the agent belongs to the caller before sending the code to the token endpoint', async () => {
        agentWorkspace = OTHER_WORKSPACE
        memberOfAgentWorkspace = false
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Coworker not found')
        expect(exchangeCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })
})
