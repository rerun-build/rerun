import { decodeContext } from '@/lib/mcp-oauth'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { fakeSupabase } from '@/test/supabase-fake'
import type { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { getVaultItem } from '@/lib/engine/vault-client'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = vi.fn()
    return { getServerSession: session, getSessionWorkspace: session }
})

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(async () => ({ instanceId: 'i', conn: { baseUrl: 'https://engine.test', apiKey: null }, managed: true })), NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), supportsVault: vi.fn(async () => true) }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))

const SESSION_WORKSPACE = 1

const RESOURCE_METADATA_URL = 'https://mcp.acme.test/.well-known/oauth-protected-resource/mcp'
const AUTH_SERVER_METADATA_URL = 'https://auth.acme.test/.well-known/oauth-authorization-server'
const CLIENT_METADATA_DOCUMENT = 'https://rerun.test/api/mcp/oauth/client-metadata'

const AUTH_SERVER_METADATA = {
    authorization_endpoint: 'https://auth.acme.test/authorize',
    token_endpoint: 'https://auth.acme.test/token',
    scopes_supported: ['read', 'write'],
    client_id_metadata_document_supported: true,
}

let agentWorkspace = SESSION_WORKSPACE
let role: 'admin' | 'member' = 'admin'
let documents: Record<string, unknown> = {}
const fetchMock = vi.fn(async (input: string | URL) => {
    const doc = documents[String(input)]
    if (doc instanceof Response) return doc.clone()
    return doc ? Response.json(doc) : new Response('not found', { status: 404 })
})

function start(body: Record<string, unknown>) {
    return POST(
        new Request('https://rerun.test/api/mcp/oauth/start', {
            method: 'POST',
            headers: { host: 'rerun.test', 'x-forwarded-proto': 'https' },
            body: JSON.stringify({ agentId: 'agent-1', serverName: 'acme', mcpUrl: 'https://mcp.acme.test/mcp', ...body }),
        }),
    ) as Promise<NextResponse>
}

beforeEach(() => {
    vi.clearAllMocks()
    agentWorkspace = SESSION_WORKSPACE
    role = 'admin'
    const db = fakeSupabase(table => {
        if (table === 'agents') return { data: { workspace_id: agentWorkspace, space_id: 'space-1', engine_agent_id: 'engine-agent' } }
        if (table === 'spaces') return { data: { id: 'space-1', workspace_id: agentWorkspace, visibility: 'workspace' } }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(getServerSession).mockImplementation(async () => ({ user: { id: 'user-1', workspace_id: SESSION_WORKSPACE }, membership: { role, box_scope: 'all' }, workspaceRefused: false }) as never)
    documents = { [RESOURCE_METADATA_URL]: { authorization_servers: ['https://auth.acme.test'] }, [AUTH_SERVER_METADATA_URL]: AUTH_SERVER_METADATA }
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    mocks.lookup.mockImplementation(async (host: string) => [{ address: host === 'metadata.acme.test' ? '169.254.169.254' : '93.184.216.34', family: 4 }])
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('POST /api/mcp/oauth/start', () => {
    it('answers the authorize URL and stashes the context in a short-lived httpOnly cookie', async () => {
        const res = await start({})

        expect(res.status).toBe(200)
        const { authorizationUrl } = (await res.json()) as { authorizationUrl: string }
        const authorize = new URL(authorizationUrl)
        expect(authorize.origin + authorize.pathname).toBe('https://auth.acme.test/authorize')
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authorize.searchParams.get('redirect_uri')).toBe('https://rerun.test/api/mcp/oauth/callback')
        expect(authorize.searchParams.get('scope')).toBe('read write')

        const [cookie] = res.cookies.getAll()
        expect(cookie.name).toBe(`mcp_oauth_${authorize.searchParams.get('state')}`)
        expect(cookie).toMatchObject({ httpOnly: true, maxAge: 600, sameSite: 'lax', path: '/api/mcp/oauth' })
        // The workspace it started in goes along: the callback's popup names none.
        expect(decodeContext(cookie.value)).toMatchObject({ agentId: 'agent-1', serverName: 'acme', tokenEndpoint: 'https://auth.acme.test/token', clientId: CLIENT_METADATA_DOCUMENT, workspaceId: SESSION_WORKSPACE })
        expect(decodeContext(cookie.value)).not.toHaveProperty('scope')
    })

    // PostHog advertises 160 scopes (~2.9 KB): carried in the cookie, they pushed it past the
    // 4096 bytes a browser stores, and the callback found no context.
    it('keeps a long scope list in the authorize URL and out of the cookie', async () => {
        const scopes = Array.from({ length: 160 }, (_, i) => `resource_${String(i).padStart(3, '0')}:write`)
        documents[RESOURCE_METADATA_URL] = { authorization_servers: ['https://auth.acme.test'], scopes_supported: scopes }

        const res = await start({})

        expect(res.status).toBe(200)
        const { authorizationUrl } = (await res.json()) as { authorizationUrl: string }
        expect(new URL(authorizationUrl).searchParams.get('scope')).toBe(scopes.join(' '))
        const [cookie] = res.cookies.getAll()
        expect(cookie.name.length + cookie.value.length).toBeLessThan(4096)
    })

    it('refuses an agent of another workspace without setting a cookie', async () => {
        agentWorkspace = 2

        const res = await start({})

        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'Coworker not found', code: 'coworkerNotFound' })
        expect(res.cookies.getAll()).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a member who only uses the Box: connecting an app changes the coworker', async () => {
        role = 'member'

        const res = await start({})

        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly' })
        expect(res.cookies.getAll()).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a caller without a session', async () => {
        vi.mocked(getServerSession).mockResolvedValue({ user: null, workspaceRefused: false } as never)

        const res = await start({})

        expect(res.status).toBe(400)
        expect(res.cookies.getAll()).toEqual([])
    })

    it('refuses to start without an OAuth client', async () => {
        documents[AUTH_SERVER_METADATA_URL] = { ...AUTH_SERVER_METADATA, client_id_metadata_document_supported: false }

        const res = await start({})

        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'No OAuth client available for this provider', code: 'noOAuthClient' })
        expect(res.cookies.getAll()).toEqual([])
    })

    it('refuses a client without a client id', async () => {
        documents[AUTH_SERVER_METADATA_URL] = { ...AUTH_SERVER_METADATA, registration_endpoint: 'https://auth.acme.test/register', client_id_metadata_document_supported: false }
        documents['https://auth.acme.test/register'] = { client_id: '' }

        const res = await start({})

        expect(res.status).toBe(400)
        expect(res.cookies.getAll()).toEqual([])
    })

    it('refuses a tokenEndpoint the server did not discover itself, since the callback POSTs the code to it and the engine later sends the refresh token there (SSRF)', async () => {
        const res = await start({ metadata: { authorizationEndpoint: 'https://auth.acme.test/authorize', tokenEndpoint: 'http://10.0.0.1/token' }, clientInfo: { clientId: 'evil' } })

        expect(res.status).toBe(200)
        const [cookie] = res.cookies.getAll()
        expect(decodeContext(cookie.value)).toMatchObject({ tokenEndpoint: 'https://auth.acme.test/token', clientId: CLIENT_METADATA_DOCUMENT })
    })

    it.each(['http://127.0.0.1:8080/mcp', 'https://metadata.acme.test/mcp'])('bases the context on a server-side discovery that refuses private and loopback hosts (%s)', async mcpUrl => {
        const res = await start({ mcpUrl })

        expect(res.status).toBe(400)
        expect(((await res.json()) as { error: string }).error).toContain('is not a public host')
        expect(res.cookies.getAll()).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('POST /api/mcp/oauth/start for a Vault entry', () => {
    const entry = { id: 'item-1', kind: 'service', slug: 'acme', name: 'Acme', status: 'needs_auth', oauth: { serverName: 'acme', url: 'https://mcp.acme.test/mcp' }, agentIds: [], sharedWithAll: false, mcpServers: [], skills: [], config: {}, envKeys: [], tokens: [], createdBy: null, createdAt: '', updatedAt: '' }

    beforeEach(() => {
        vi.mocked(getVaultItem).mockResolvedValue(entry as never)
        vi.mocked(createServiceRoleClient).mockReturnValue(
            fakeSupabase(table => {
                if (table === 'agents') return { data: [] }
                if (table === 'spaces') return { data: [{ id: 'space-1', workspace_id: SESSION_WORKSPACE, visibility: 'workspace' }] }
                if (table === 'space_members') return { data: [] }
                return undefined
            }).client,
        )
    })

    it("signs in the entry's own server at its own address, whatever the caller sends", async () => {
        const res = await start({ agentId: undefined, vaultItemId: 'item-1', mcpUrl: 'https://evil.test/mcp' })

        expect(res.status).toBe(200)
        const [cookie] = res.cookies.getAll()
        expect(decodeContext(cookie.value)).toMatchObject({ agentId: '', serverName: 'acme', mcpUrl: 'https://mcp.acme.test/mcp', vault: { itemId: 'item-1', workspaceId: SESSION_WORKSPACE } })
    })

    it('refuses a server the entry does not sign in through', async () => {
        const res = await start({ agentId: undefined, vaultItemId: 'item-1', serverName: 'other' })

        expect(res.status).toBe(400)
        expect(res.cookies.getAll()).toEqual([])
    })

    it('refuses a member who manages no Box', async () => {
        role = 'member'

        const res = await start({ agentId: undefined, vaultItemId: 'item-1' })

        expect(res.status).toBe(400)
        expect(res.cookies.getAll()).toEqual([])
        expect(getVaultItem).not.toHaveBeenCalled()
    })

    describe('for WordPress.com, which refuses to register a client from the address of the hub', () => {
        const WPCOM_MCP = 'https://public-api.wordpress.com/wpcom/v2/mcp/v1'
        const WPCOM_REGISTER = 'https://public-api.wordpress.com/oauth2-1/register'

        beforeEach(() => {
            vi.mocked(getVaultItem).mockResolvedValue({ ...entry, slug: 'wordpress', oauth: { serverName: 'wordpress', url: WPCOM_MCP } } as never)
            documents = {
                'https://public-api.wordpress.com/.well-known/oauth-protected-resource/wpcom/v2/mcp/v1': { resource: WPCOM_MCP, authorization_servers: ['https://public-api.wordpress.com'], scopes_supported: ['global', 'auth', 'openid', 'posts', 'media'] },
                'https://public-api.wordpress.com/.well-known/oauth-authorization-server': {
                    authorization_endpoint: 'https://public-api.wordpress.com/oauth2-1/authorize',
                    token_endpoint: 'https://public-api.wordpress.com/oauth2-1/token',
                    registration_endpoint: WPCOM_REGISTER,
                    scopes_supported: ['global', 'auth', 'openid', 'posts', 'media'],
                },
                [WPCOM_REGISTER]: Response.json({ error: 'invalid_request', error_description: 'Registration failed. Please try again.' }, { status: 400 }),
            }
        })

        it('fails at the registration without an app of its own', async () => {
            const res = await start({ agentId: undefined, vaultItemId: 'item-1', serverName: 'wordpress' })

            expect(res.status).toBe(400)
            expect(((await res.json()) as { error: string }).error).toBe('client registration failed (400)')
        })

        it("signs in through Rerun's own app on the OAuth 2 endpoints, the secret kept on the hub", async () => {
            vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_ID', 'wpcom-app')
            vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_SECRET', 'wpcom-secret')

            const res = await start({ agentId: undefined, vaultItemId: 'item-1', serverName: 'wordpress' })

            expect(res.status).toBe(200)
            const authorize = new URL(((await res.json()) as { authorizationUrl: string }).authorizationUrl)
            expect(authorize.origin + authorize.pathname).toBe('https://public-api.wordpress.com/oauth2/authorize')
            expect(authorize.searchParams.get('client_id')).toBe('wpcom-app')
            expect(authorize.searchParams.get('scope')).toBe('global')
            const context = decodeContext(res.cookies.getAll()[0].value)
            expect(context).toMatchObject({ clientId: 'wpcom-app', tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token', mcpUrl: WPCOM_MCP })
            expect(context.clientSecret).toBeUndefined()
            expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(WPCOM_REGISTER)
        })
    })
})
