import { decodeContext } from '@/lib/mcp-oauth'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { fakeSupabase } from '@/test/supabase-fake'
import type { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/session/getServerSession', () => {
    const session = vi.fn()
    return { getServerSession: session, getSessionWorkspace: session }
})

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
        expect(decodeContext(cookie.value)).toMatchObject({ agentId: 'agent-1', serverName: 'acme', tokenEndpoint: 'https://auth.acme.test/token', clientId: CLIENT_METADATA_DOCUMENT })
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
        expect(await res.json()).toEqual({ error: 'Coworker not found' })
        expect(res.cookies.getAll()).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a member who only uses the Box: connecting an app changes the coworker', async () => {
        role = 'member'

        const res = await start({})

        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'Only an admin or a manager of this Box can do this' })
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
        expect(await res.json()).toEqual({ error: 'No OAuth client available for this provider' })
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
