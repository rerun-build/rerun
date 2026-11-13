import { markManagedAuthorized } from '@/app/api/_services/services.service'
import { findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { putMcpToken } from '@/lib/engine/client'
import { type ManagedOAuthContext, encodeManagedContext, exchangeManagedCode } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import type { ManagedProvider } from '@/lib/managed/types'
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
vi.mock('@/app/api/_services/services.service', () => ({ markManagedAuthorized: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ putMcpToken: vi.fn(), deleteMcpToken: vi.fn(), supportsVault: vi.fn(async () => false), listRuns: vi.fn() }))
vi.mock('@/lib/oauth/pending-grant', () => ({ parkSignIn: vi.fn() }))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: vi.fn() }))
vi.mock('@/lib/managed/oauth', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/managed/oauth')>()), exchangeManagedCode: vi.fn() }))

const SESSION_WORKSPACE = 1
const OTHER_WORKSPACE = 2
const STATE = 'state-1'
const COOKIE = `managed_oauth_${STATE}`

const PROVIDER: ManagedProvider = {
    id: 'acme',
    label: 'Acme',
    oauth: {
        authorizationEndpoint: 'https://acme.test/authorize',
        tokenEndpoint: 'https://acme.test/token',
        scopes: ['read'],
        clientIdEnv: 'ACME_CLIENT_ID',
        clientSecretEnv: 'ACME_CLIENT_SECRET',
        accountEmail: async () => 'me@acme.test',
    },
    tools: [],
}

const CONTEXT: ManagedOAuthContext = {
    verifier: 'verifier',
    agentId: 'agent-1',
    key: 'acme',
    provider: 'acme',
    serverName: 'acme',
    redirectUri: 'https://rerun.test/api/oauth/managed/acme/callback',
}

let agentWorkspace = SESSION_WORKSPACE
let memberOfAgentWorkspace = true
let role: 'admin' | 'member' = 'admin'
let jar: Record<string, string> = {}

function callback(params: Record<string, string>, provider = 'acme') {
    return GET(new Request(`https://rerun.test/api/oauth/managed/${provider}/callback?${new URLSearchParams(params)}`), { params: Promise.resolve({ provider }) })
}

function withContext(ctx: ManagedOAuthContext) {
    jar = { [COOKIE]: encodeManagedContext(ctx) }
}

function deletesStateCookie(res: Response) {
    const header = res.headers.get('set-cookie') ?? ''
    return header.includes(`${COOKIE}=;`) && header.includes('Path=/api/oauth/managed') && header.includes('Expires=Thu, 01 Jan 1970')
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.stubEnv('ACME_CLIENT_ID', 'acme-id')
    vi.stubEnv('ACME_CLIENT_SECRET', 'acme-secret')
    agentWorkspace = SESSION_WORKSPACE
    memberOfAgentWorkspace = true
    role = 'admin'
    jar = {}
    const db = fakeSupabase(table => {
        if (table === 'agents') return { data: { workspace_id: agentWorkspace, space_id: 'space-1', engine_agent_id: 'engine-agent', template_id: null, disabled_at: null, disabled_reason: null, workspaces: { subscription_status: 'active', is_sandbox: false }, space: { visibility: 'workspace' } } }
        if (table === 'spaces') return { data: { id: 'space-1', workspace_id: agentWorkspace, visibility: 'workspace' } }
        if (table === 'workspace_members') return { data: memberOfAgentWorkspace ? { user_id: 'user-1', role, box_scope: 'all' } : null }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1', workspace_id: SESSION_WORKSPACE }, workspaceRefused: false } as never)
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (jar[name] === undefined ? undefined : { name, value: jar[name] }) } as never)
    vi.mocked(getWorkspaceConnection).mockResolvedValue({ baseUrl: 'https://engine.test', apiKey: null })
    vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i1', conn: { baseUrl: 'https://engine.test', apiKey: null }, managed: true })
    vi.mocked(getManagedProvider).mockReturnValue(PROVIDER)
    vi.mocked(exchangeManagedCode).mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' })
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('GET /api/oauth/managed/[provider]/callback', () => {
    it('stores the token with the server client and marks the service connected', async () => {
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        const html = await res.text()
        expect(html).toContain('Connected as me@acme.test')
        expect(html).toContain('"key":"acme"')
        expect(putMcpToken).toHaveBeenCalledWith(
            { baseUrl: 'https://engine.test', apiKey: null },
            'engine-agent',
            'acme',
            expect.objectContaining({ accessToken: 'access', tokenEndpoint: 'https://acme.test/token', clientId: 'acme-id', clientSecret: 'acme-secret' }),
        )
        expect(markManagedAuthorized).toHaveBeenCalledWith('agent-1', 'acme', 'me@acme.test', { kind: 'workspace', workspaceId: SESSION_WORKSPACE })
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('reports the error and its description the provider sent back', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        withContext(CONTEXT)

        const res = await callback({ error: 'access_denied', error_description: 'User said no', state: STATE })

        expect(await res.text()).toContain('Authorization failed: access_denied: User said no')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
    })

    it('renders a hostile provider error as text, before any cookie is read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const res = await callback({ error: 'access_denied', error_description: '</script><img src=x onerror=alert(1)>' })
        const body = await res.text()

        expect(body).not.toContain('<img')
        expect(body).toContain('Authorization failed: access_denied: &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    })

    it('refuses a callback without a code', async () => {
        withContext(CONTEXT)

        const res = await callback({ state: STATE })

        expect(await res.text()).toContain('Missing code or state')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
    })

    it('clears the state cookie when the provider answers with an error or no code', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        withContext(CONTEXT)

        expect(deletesStateCookie(await callback({ error: 'access_denied', state: STATE }))).toBe(true)
        expect(deletesStateCookie(await callback({ state: STATE }))).toBe(true)
        expect(exchangeManagedCode).not.toHaveBeenCalled()
    })

    it('refuses a forged context cookie without exchanging the code', async () => {
        jar = { [COOKIE]: Buffer.from(JSON.stringify({ ...CONTEXT, agentId: 'agent-of-a-victim' })).toString('base64') }

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('asks to retry when the state cookie is gone, and still clears it', async () => {
        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Session expired, please retry')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('refuses an unknown provider and clears the state cookie', async () => {
        vi.mocked(getManagedProvider).mockReturnValue(undefined)
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE }, 'nope')

        expect(await res.text()).toContain('Unknown provider: nope')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('refuses to finish when the server client is not configured', async () => {
        vi.stubEnv('ACME_CLIENT_SECRET', '')
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Acme is not configured on this server.')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
    })

    it('writes no token and marks nothing for a member who only uses the Box of the coworker', async () => {
        role = 'member'
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Only an admin or a manager of this Box can do this')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
    })

    it('writes no token and marks nothing for an agent of another workspace', async () => {
        agentWorkspace = OTHER_WORKSPACE
        memberOfAgentWorkspace = false
        withContext(CONTEXT)

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Authorization failed: Coworker not found')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('sends a forged mobile grant back to the app as an error without writing anything', async () => {
        withContext({ ...CONTEXT, mobileGrant: 'forged.signature' })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(res.status).toBe(302)
        const location = new URL(res.headers.get('location') ?? '')
        expect(location.protocol).toBe('rerun:')
        expect(location.searchParams.get('message')).toBe('Invalid sign-in grant')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })

    it('writes nothing when a valid mobile grant names a workspace that does not own the agent', async () => {
        agentWorkspace = OTHER_WORKSPACE
        withContext({ ...CONTEXT, mobileGrant: mintCallbackGrant({ agentId: CONTEXT.agentId, workspaceId: SESSION_WORKSPACE, userId: 'user-1', jti: 'row-1' }) })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(new URL(res.headers.get('location') ?? '').searchParams.get('status')).toBe('error')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
    })

    it('parks the token of a valid mobile grant without its client secret, and marks nothing yet', async () => {
        withContext({ ...CONTEXT, mobileGrant: mintCallbackGrant({ agentId: CONTEXT.agentId, workspaceId: SESSION_WORKSPACE, userId: 'user-1', jti: 'row-1' }) })

        const res = await callback({ code: 'code-1', state: STATE })

        const location = new URL(res.headers.get('location') ?? '')
        expect(location.searchParams.get('status')).toBe('success')
        expect(location.searchParams.get('claim')).toBe('row-1')
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
        expect(parkSignIn).toHaveBeenCalledWith(expect.objectContaining({ jti: 'row-1' }), { kind: 'managed', key: 'acme', provider: 'acme', serverName: 'acme', token: expect.objectContaining({ accessToken: expect.any(String) }), email: 'me@acme.test' })
        expect(JSON.stringify(vi.mocked(parkSignIn).mock.calls[0][1])).not.toContain('secret')
    })

    it('refuses a context started for another provider than the one in the callback path', async () => {
        withContext({ ...CONTEXT, provider: 'other' })

        const res = await callback({ code: 'code-1', state: STATE })

        expect(await res.text()).toContain('Provider mismatch, please retry')
        expect(exchangeManagedCode).not.toHaveBeenCalled()
        expect(putMcpToken).not.toHaveBeenCalled()
        expect(markManagedAuthorized).not.toHaveBeenCalled()
        expect(deletesStateCookie(res)).toBe(true)
    })
})
