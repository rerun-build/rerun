import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type OAuthContext, buildAuthorizeUrl, callbackUrl, clientMetadataDocument, createPkce, decodeContext, discoverAuthServer, encodeContext, engineClientSecret, exchangeCode, registerClient, resolveClient } from './mcp-oauth'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

const AUTH_META = { authorization_endpoint: 'https://auth.example/authorize', token_endpoint: 'https://auth.example/token' }
// What a server publishes about itself, with no protected-resource document naming another issuer.
const SELF_META = { authorization_endpoint: 'https://mcp.example/authorize', token_endpoint: 'https://mcp.example/token' }
const FIRECRAWL_META = { authorization_endpoint: 'https://www.firecrawl.dev/authorize', token_endpoint: 'https://www.firecrawl.dev/token' }
const DROPBOX_MCP = 'https://mcp.dropbox.com/mcp'
// What www.dropbox.com publishes: its token endpoint lives on another registrable domain.
const DROPBOX_META = {
    issuer: 'https://www.dropbox.com',
    authorization_endpoint: 'https://www.dropbox.com/oauth2/authorize',
    token_endpoint: 'https://api.dropboxapi.com/oauth2/token',
    registration_endpoint: 'https://www.dropbox.com/oauth2/register',
}
const DROPBOX_DOCUMENTS = {
    'https://mcp.dropbox.com/.well-known/oauth-protected-resource/mcp': { resource: DROPBOX_MCP, authorization_servers: ['https://www.dropbox.com'], scopes_supported: ['files.content.read'] },
    'https://www.dropbox.com/.well-known/oauth-authorization-server': DROPBOX_META,
}

function stubFetch(documents: Record<string, unknown>) {
    const requested: string[] = []
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
            const url = String(input)
            requested.push(url)
            const doc = documents[url]
            return doc ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('not found', { status: 404 })
        }),
    )
    return requested
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('discoverAuthServer', () => {
    it('tries the path-aware protected-resource document before the root one', async () => {
        const requested = stubFetch({ 'https://mcp.example/.well-known/oauth-authorization-server': SELF_META })
        await discoverAuthServer('https://mcp.example/mcp/')
        expect(requested.slice(0, 2)).toEqual(['https://mcp.example/.well-known/oauth-protected-resource/mcp', 'https://mcp.example/.well-known/oauth-protected-resource'])
    })

    it('inserts the well-known segment before the issuer path, most specific first', async () => {
        const requested = stubFetch({
            'https://mcp.example/.well-known/oauth-protected-resource': { authorization_servers: ['https://login.wrike.com/oauth2'] },
            'https://login.wrike.com/.well-known/openid-configuration': { authorization_endpoint: 'https://login.wrike.com/oauth2/authorize', token_endpoint: 'https://login.wrike.com/oauth2/token' },
        })
        await discoverAuthServer('https://mcp.example')
        expect(requested.slice(1)).toEqual([
            'https://login.wrike.com/.well-known/oauth-authorization-server/oauth2',
            'https://login.wrike.com/.well-known/openid-configuration/oauth2',
            'https://login.wrike.com/oauth2/.well-known/openid-configuration',
            'https://login.wrike.com/.well-known/oauth-authorization-server',
            'https://login.wrike.com/.well-known/openid-configuration',
        ])
    })

    it('prefers the scopes of the protected resource over the global ones of the server', async () => {
        stubFetch({
            'https://mcp.example/.well-known/oauth-protected-resource': { authorization_servers: ['https://auth.example'], scopes_supported: ['read'] },
            'https://auth.example/.well-known/oauth-authorization-server': { ...AUTH_META, scopes_supported: ['read', 'admin'], registration_endpoint: 'https://auth.example/register' },
        })
        expect(await discoverAuthServer('https://mcp.example')).toEqual({
            authorizationEndpoint: AUTH_META.authorization_endpoint,
            tokenEndpoint: AUTH_META.token_endpoint,
            registrationEndpoint: 'https://auth.example/register',
            scopesSupported: ['read'],
            clientIdMetadataDocumentSupported: false,
        })
    })

    it('skips a metadata document that lacks either endpoint', async () => {
        stubFetch({
            'https://mcp.example/.well-known/oauth-authorization-server': { authorization_endpoint: 'https://x/authorize' },
            'https://mcp.example/.well-known/openid-configuration': { ...SELF_META, client_id_metadata_document_supported: true },
        })
        const meta = await discoverAuthServer('https://mcp.example')
        expect(meta.tokenEndpoint).toBe(SELF_META.token_endpoint)
        expect(meta.clientIdMetadataDocumentSupported).toBe(true)
    })

    it('falls back to the parent domain when the MCP subdomain publishes nothing', async () => {
        const requested = stubFetch({ 'https://firecrawl.dev/.well-known/oauth-authorization-server': FIRECRAWL_META })
        await expect(discoverAuthServer('https://mcp.firecrawl.dev')).resolves.toMatchObject({ tokenEndpoint: FIRECRAWL_META.token_endpoint })
        expect(requested.at(-1)).toBe('https://firecrawl.dev/.well-known/oauth-authorization-server')
    })

    it('walks up every label under the registrable domain', async () => {
        const requested = stubFetch({})
        await expect(discoverAuthServer('https://a.b.acme.com')).rejects.toThrow('does not advertise')
        const origins = new Set(requested.map(url => new URL(url).origin))
        expect([...origins]).toEqual(['https://a.b.acme.com', 'https://b.acme.com', 'https://acme.com'])
    })

    it('never walks up to a public suffix such as co.uk', async () => {
        const requested = stubFetch({})
        await expect(discoverAuthServer('https://mcp.acme.co.uk')).rejects.toThrow('does not advertise')
        const origins = new Set(requested.map(url => new URL(url).origin))
        expect([...origins]).toEqual(['https://mcp.acme.co.uk', 'https://acme.co.uk'])
    })

    it('does not walk up from a registrable domain', async () => {
        const requested = stubFetch({})
        await expect(discoverAuthServer('https://acme.com')).rejects.toThrow()
        expect(new Set(requested.map(url => new URL(url).origin))).toEqual(new Set(['https://acme.com']))
    })

    it('refuses a private MCP URL before fetching anything', async () => {
        const requested = stubFetch({})
        await expect(discoverAuthServer('http://127.0.0.1:8080/mcp')).rejects.toThrow('127.0.0.1:8080 is not a public host')
        expect(requested).toEqual([])
    })

    it('never fetches a private authorization server named by the protected-resource document', async () => {
        const requested = stubFetch({ 'https://mcp.example/.well-known/oauth-protected-resource': { authorization_servers: ['http://169.254.169.254'] } })
        await expect(discoverAuthServer('https://mcp.example')).rejects.toThrow('does not advertise')
        expect(requested.filter(url => url.startsWith('http://169.254.169.254'))).toEqual([])
    })

    it('refuses endpoints that point away from the server and from the issuer it named', async () => {
        stubFetch({ 'https://mcp.example/.well-known/oauth-authorization-server': { ...SELF_META, authorization_endpoint: 'https://phish.example/login' } })
        await expect(discoverAuthServer('https://mcp.example')).rejects.toThrow('authorization endpoint of this server points away from it (phish.example)')

        stubFetch({ 'https://mcp.example/.well-known/oauth-authorization-server': { ...SELF_META, token_endpoint: 'http://10.0.0.1/token' } })
        await expect(discoverAuthServer('https://mcp.example')).rejects.toThrow('not a public host')
    })

    it('accepts endpoints on the issuer the protected-resource document named, and on a sibling of the server', async () => {
        stubFetch({
            'https://mcp.example/.well-known/oauth-protected-resource': { authorization_servers: ['https://auth.example'] },
            'https://auth.example/.well-known/oauth-authorization-server': AUTH_META,
        })
        await expect(discoverAuthServer('https://mcp.example')).resolves.toMatchObject({ authorizationEndpoint: AUTH_META.authorization_endpoint })

        stubFetch({ 'https://mcp.linear.app/.well-known/oauth-authorization-server': { authorization_endpoint: 'https://linear.app/oauth/authorize', token_endpoint: 'https://api.linear.app/oauth/token' } })
        await expect(discoverAuthServer('https://mcp.linear.app/mcp')).resolves.toMatchObject({ tokenEndpoint: 'https://api.linear.app/oauth/token' })
    })

    it("accepts Dropbox's token endpoint on api.dropboxapi.com, which Rerun names itself for mcp.dropbox.com", async () => {
        stubFetch(DROPBOX_DOCUMENTS)
        await expect(discoverAuthServer(DROPBOX_MCP)).resolves.toMatchObject({
            authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
            tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
        })
    })

    it('still refuses another server whose token endpoint points at api.dropboxapi.com', async () => {
        stubFetch({ 'https://mcp.other.example/.well-known/oauth-authorization-server': { ...DROPBOX_META, authorization_endpoint: 'https://mcp.other.example/authorize' } })
        await expect(discoverAuthServer('https://mcp.other.example/mcp')).rejects.toThrow('token endpoint of this server points away from it (api.dropboxapi.com)')
    })

    describe('the resource indicator', () => {
        const BROWSERACT_MCP = 'https://mcp.browseract.com/mcp/'
        const PRM = 'https://mcp.browseract.com/.well-known/oauth-protected-resource/mcp'
        const BROWSERACT_META = { authorization_endpoint: 'https://mcp.browseract.com/oauth2/auth', token_endpoint: 'https://mcp.browseract.com/oauth2/token' }
        const publishing = (resource: unknown) =>
            stubFetch({
                [PRM]: { resource, authorization_servers: ['https://mcp.browseract.com'] },
                'https://mcp.browseract.com/.well-known/oauth-authorization-server': BROWSERACT_META,
            })

        it('is the one the server advertises when the typed URL only adds a trailing slash', async () => {
            publishing('https://mcp.browseract.com/mcp')
            const meta = await discoverAuthServer(BROWSERACT_MCP)
            expect(meta.resource).toBe('https://mcp.browseract.com/mcp')
            const url = new URL(buildAuthorizeUrl(meta, { ...CTX, mcpUrl: BROWSERACT_MCP, resource: meta.resource }, 'c', 's'))
            expect(url.searchParams.get('resource')).toBe('https://mcp.browseract.com/mcp')
        })

        it.each([
            ['another path', 'https://mcp.browseract.com/other'],
            ['another origin', 'https://evil.example/mcp'],
            ['something that is not a string', 42],
        ])('ignores an advertised resource on %s', async (_label, resource) => {
            publishing(resource)
            await expect(discoverAuthServer(BROWSERACT_MCP)).resolves.not.toHaveProperty('resource')
        })
    })

    it('treats a network failure as a missing document', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
        await expect(discoverAuthServer('https://acme.com')).rejects.toThrow('does not advertise')
    })

    describe('when the server only names its protected-resource document in its 401', () => {
        // A Supabase edge function owns nothing at the root of its domain, gateway included.
        const MCP_URL = 'https://ref.supabase.co/functions/v1/mcp'
        const NAMED = `${MCP_URL}/.well-known/oauth-protected-resource`
        const ISSUER = 'https://ref.supabase.co/auth/v1'
        const SUPABASE_META = {
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/oauth/authorize`,
            token_endpoint: `${ISSUER}/oauth/token`,
            registration_endpoint: `${ISSUER}/oauth/clients/register`,
            scopes_supported: ['openid', 'email'],
        }
        const DOCUMENTS = {
            [NAMED]: { resource: MCP_URL, authorization_servers: [ISSUER] },
            'https://ref.supabase.co/.well-known/oauth-authorization-server/auth/v1': SUPABASE_META,
        }

        function stubServer(answer: () => Response, documents: Record<string, unknown> = DOCUMENTS) {
            const calls: { url: string; method: string; body: unknown }[] = []
            vi.stubGlobal(
                'fetch',
                vi.fn(async (input: string | URL, init?: RequestInit) => {
                    const url = String(input)
                    const method = init?.method ?? 'GET'
                    calls.push({ url, method, body: init?.body })
                    if (method === 'POST') return answer()
                    const doc = documents[url]
                    return doc ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('not found', { status: url.endsWith('/functions/v1/mcp') ? 401 : 404 })
                }),
            )
            return calls
        }

        const unauthorized = (challenge: string | null, status = 401) => () => new Response('{"error":"unauthorized"}', { status, headers: challenge ? { 'WWW-Authenticate': challenge } : {} })

        it('reads the document the 401 names', async () => {
            const calls = stubServer(unauthorized(`Bearer realm="mcp", resource_metadata="${NAMED}"`))
            expect(await discoverAuthServer(MCP_URL)).toEqual({
                authorizationEndpoint: SUPABASE_META.authorization_endpoint,
                tokenEndpoint: SUPABASE_META.token_endpoint,
                registrationEndpoint: SUPABASE_META.registration_endpoint,
                scopesSupported: ['openid', 'email'],
                clientIdMetadataDocumentSupported: false,
                resource: MCP_URL,
            })
            const posts = calls.filter(call => call.method === 'POST')
            expect(posts.map(call => call.url)).toEqual([MCP_URL])
            expect(JSON.parse(String(posts[0].body))).toMatchObject({ jsonrpc: '2.0', method: 'initialize' })
        })

        it.each([
            ['unquoted', `Bearer resource_metadata=${NAMED}`],
            ['unquoted and followed by another parameter', `Bearer resource_metadata=${NAMED}, error="invalid_token"`],
            ['spaced and capitalised', `Bearer error="invalid_token", Resource_Metadata = "${NAMED}", scope="read"`],
            ['beside another scheme', `Basic realm="x", Bearer resource_metadata="${NAMED}"`],
        ])('reads it %s', async (_label, challenge) => {
            stubServer(unauthorized(challenge))
            await expect(discoverAuthServer(MCP_URL)).resolves.toMatchObject({ tokenEndpoint: SUPABASE_META.token_endpoint })
        })

        it('prefers the scopes of the document it names', async () => {
            stubServer(unauthorized(`Bearer resource_metadata="${NAMED}"`), { ...DOCUMENTS, [NAMED]: { authorization_servers: [ISSUER], scopes_supported: ['email'] } })
            await expect(discoverAuthServer(MCP_URL)).resolves.toMatchObject({ scopesSupported: ['email'] })
        })

        it.each([
            ['another origin', unauthorized('Bearer resource_metadata="https://evil.supabase.co/prm"')],
            ['a private address', unauthorized('Bearer resource_metadata="http://169.254.169.254/prm"')],
            ['something that is not a URL', unauthorized('Bearer resource_metadata="nope"')],
            ['nothing', unauthorized('Bearer realm="mcp"')],
            ['no challenge at all', unauthorized(null)],
            ['a document on an answer that is not a 401', unauthorized(`Bearer resource_metadata="${NAMED}"`, 200)],
            ['a missing document', unauthorized(`Bearer resource_metadata="${NAMED}/missing"`)],
        ])('ignores a server that names %s', async (_label, answer) => {
            const calls = stubServer(answer)
            await expect(discoverAuthServer(MCP_URL)).rejects.toThrow('does not advertise')
            expect(calls.every(call => call.url.startsWith('https://ref.supabase.co/') || call.url.startsWith('https://supabase.co/'))).toBe(true)
        })

        it('releases the stream of a server that answers without asking for a sign-in', async () => {
            const cancelled = vi.fn()
            stubServer(() => new Response(new ReadableStream({ cancel: cancelled }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
            await expect(discoverAuthServer(MCP_URL)).rejects.toThrow('does not advertise')
            expect(cancelled).toHaveBeenCalledOnce()
        })

        it('still falls back to the metadata of the origin', async () => {
            stubServer(unauthorized(null), { 'https://mcp.example/.well-known/oauth-authorization-server': SELF_META })
            await expect(discoverAuthServer('https://mcp.example/mcp')).resolves.toMatchObject({ tokenEndpoint: SELF_META.token_endpoint })
        })

        it('never calls the server when a well-known document is published', async () => {
            const calls = stubServer(unauthorized(`Bearer resource_metadata="${NAMED}"`), {
                'https://mcp.example/.well-known/oauth-protected-resource/mcp': { authorization_servers: ['https://auth.example'] },
                'https://auth.example/.well-known/oauth-authorization-server': AUTH_META,
            })
            await expect(discoverAuthServer('https://mcp.example/mcp')).resolves.toMatchObject({ tokenEndpoint: AUTH_META.token_endpoint })
            expect(calls.filter(call => call.method === 'POST')).toEqual([])
        })
    })
})

describe('callbackUrl', () => {
    it('uses the forwarded host and protocol', () => {
        const req = new Request('http://internal:8080/x', { headers: { 'x-forwarded-host': 'app.rerun.build', 'x-forwarded-proto': 'https' } })
        expect(callbackUrl(req)).toBe('https://app.rerun.build/api/mcp/oauth/callback')
    })

    it('defaults to http on localhost and https elsewhere', () => {
        expect(callbackUrl(new Request('http://x/', { headers: { host: 'localhost:3000' } }))).toBe('http://localhost:3000/api/mcp/oauth/callback')
        expect(callbackUrl(new Request('http://x/', { headers: { host: 'staging.rerun.build' } }))).toBe('https://staging.rerun.build/api/mcp/oauth/callback')
    })
})

describe('clientMetadataDocument', () => {
    it('names its own URL as the client id and the callback as the only redirect', () => {
        const doc = clientMetadataDocument(new Request('http://x/', { headers: { host: 'app.rerun.build' } }))
        expect(doc.client_id).toBe('https://app.rerun.build/api/mcp/oauth/client-metadata')
        expect(doc.redirect_uris).toEqual(['https://app.rerun.build/api/mcp/oauth/callback'])
        expect(doc.token_endpoint_auth_method).toBe('none')
    })

    it('names the product Rerun, or the brand the app is shown under', () => {
        const request = new Request('http://x/', { headers: { host: 'app.rerun.build' } })
        expect(clientMetadataDocument(request).client_name).toBe('Rerun')
        expect(clientMetadataDocument(request, 'Acme').client_name).toBe('Acme')
    })
})

const CTX: OAuthContext = {
    verifier: 'v',
    agentId: 'agent-1',
    serverName: 'Linear',
    mcpUrl: 'https://mcp.linear.app/mcp',
    tokenEndpoint: 'https://linear.app/token',
    clientId: 'client-1',
    redirectUri: 'https://app.rerun.build/api/mcp/oauth/callback',
}

describe('createPkce', () => {
    it('derives the challenge as the url-safe sha256 of the verifier', async () => {
        const { createHash } = await import('node:crypto')
        const { verifier, challenge, state } = createPkce()
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
        expect(`${verifier}${state}`).toMatch(/^[A-Za-z0-9_-]+$/)
    })
})

describe('buildAuthorizeUrl', () => {
    it('carries the PKCE challenge and the resource, and the scope only when set', () => {
        const meta = { authorizationEndpoint: 'https://linear.app/authorize', tokenEndpoint: CTX.tokenEndpoint }
        const url = new URL(buildAuthorizeUrl(meta, CTX, 'chal', 'st'))
        expect(Object.fromEntries(url.searchParams)).toEqual({
            response_type: 'code',
            client_id: 'client-1',
            redirect_uri: CTX.redirectUri,
            state: 'st',
            code_challenge: 'chal',
            code_challenge_method: 'S256',
            resource: CTX.mcpUrl,
        })
        expect(new URL(buildAuthorizeUrl({ ...meta, scopesSupported: ['read', 'write'] }, CTX, 'c', 's')).searchParams.get('scope')).toBe('read write')
    })

    it('adds the parameters a sign-in asks for, such as the offline access Dropbox needs to hand out a refresh token', () => {
        const meta = { authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize', tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token', authorizeParams: { token_access_type: 'offline' } }
        const url = new URL(buildAuthorizeUrl(meta, CTX, 'chal', 'st'))
        expect(url.searchParams.get('token_access_type')).toBe('offline')
        expect(url.searchParams.get('code_challenge')).toBe('chal')
    })
})

describe('registerClient', () => {
    it('returns the registered client', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ client_id: 'c', client_secret: 's' })))
        await expect(registerClient('https://auth/register', CTX.redirectUri)).resolves.toEqual({ clientId: 'c', clientSecret: 's' })
    })

    it('throws on a refused registration or a missing client id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })))
        await expect(registerClient('https://auth/register', CTX.redirectUri)).rejects.toThrow('client registration failed (400)')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})))
        await expect(registerClient('https://auth/register', CTX.redirectUri)).rejects.toThrow('no client_id')
    })
})

describe('resolveClient', () => {
    const GITHUB_MCP = 'https://api.githubcopilot.com/mcp/'
    const NO_REGISTRATION = { authorizationEndpoint: 'https://github.com/login/oauth/authorize', tokenEndpoint: 'https://github.com/login/oauth/access_token' }
    const request = new Request('https://app.rerun.build/api/mcp/oauth/discover', { headers: { host: 'app.rerun.build' } })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('hands out the pre-registered GitHub app by id only, keeping its secret on the hub', async () => {
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', 'gh-id')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_SECRET', 'gh-secret')
        await expect(resolveClient(NO_REGISTRATION, GITHUB_MCP, request)).resolves.toEqual({ clientId: 'gh-id' })
    })

    it('never lends the GitHub app to another MCP server, even one naming GitHub as issuer', async () => {
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', 'gh-id')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_SECRET', 'gh-secret')
        await expect(resolveClient(NO_REGISTRATION, 'https://mcp.evil.example/mcp', request)).resolves.toBeNull()
    })

    it('finds no client for GitHub when the app is not configured on this server', async () => {
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', '')
        await expect(resolveClient(NO_REGISTRATION, GITHUB_MCP, request)).resolves.toBeNull()
    })

    it("signs in to Dropbox through Rerun's own app, since its registration only serves Dropbox's partners", async () => {
        vi.stubEnv('RERUN_DROPBOX_MCP_CLIENT_ID', 'dropbox-key')
        vi.stubEnv('RERUN_DROPBOX_MCP_CLIENT_SECRET', 'dropbox-secret')
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'registration_not_supported' }, { status: 403 }))
        vi.stubGlobal('fetch', fetchMock)
        const discovered = { authorizationEndpoint: DROPBOX_META.authorization_endpoint, tokenEndpoint: DROPBOX_META.token_endpoint, registrationEndpoint: DROPBOX_META.registration_endpoint }
        const client = await resolveClient(discovered, DROPBOX_MCP, request)
        expect(client).toMatchObject({
            clientId: 'dropbox-key',
            signIn: { authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize', tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token', authorizeParams: { token_access_type: 'offline' } },
        })
        expect(client).not.toHaveProperty('clientSecret')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('falls back to a Client ID Metadata Document when DCR is refused', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })))
        const metadata = { ...NO_REGISTRATION, registrationEndpoint: 'https://auth/register', clientIdMetadataDocumentSupported: true }
        await expect(resolveClient(metadata, 'https://mcp.example/mcp', request)).resolves.toEqual({ clientId: 'https://app.rerun.build/api/mcp/oauth/client-metadata' })
    })

    it('sends HeyGen its Client ID Metadata Document without registering, since its DCR hands out a shared client', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ client_id: 'heygen-shared', client_name: 'HeyGen MCP Default' }, { status: 201 }))
        vi.stubGlobal('fetch', fetchMock)
        const metadata = { ...NO_REGISTRATION, registrationEndpoint: 'https://api2.heygen.com/v1/oauth/register', clientIdMetadataDocumentSupported: true }
        await expect(resolveClient(metadata, 'https://mcp.heygen.com/mcp/v1/', request)).resolves.toEqual({ clientId: 'https://app.rerun.build/api/mcp/oauth/client-metadata' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps a successful DCR for other servers that also support a Client ID Metadata Document', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ client_id: 'dcr-id' }, { status: 201 })))
        const metadata = { ...NO_REGISTRATION, registrationEndpoint: 'https://auth/register', clientIdMetadataDocumentSupported: true }
        await expect(resolveClient(metadata, 'https://mcp.example/mcp', request)).resolves.toEqual({ clientId: 'dcr-id' })
    })
})

describe('exchangeCode', () => {
    it('turns expires_in into an absolute expiry and drops fields of the wrong type', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_000)
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at', refresh_token: 42, expires_in: 60, scope: 'read' }))
        vi.stubGlobal('fetch', fetchMock)
        await expect(exchangeCode({ ...CTX, clientSecret: 'sec' }, 'code-1')).resolves.toEqual({ accessToken: 'at', refreshToken: undefined, expiresAt: 61_000, scope: 'read' })
        const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
        expect(body.get('code_verifier')).toBe('v')
        expect(body.get('client_secret')).toBe('sec')
        vi.restoreAllMocks()
    })

    it('adds the pre-registered secret server-side, only for the client it belongs to', async () => {
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', 'gh-id')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_SECRET', 'gh-secret')
        const fetchMock = vi.fn(async () => Response.json({ access_token: 'at' }))
        vi.stubGlobal('fetch', fetchMock)
        const github = { ...CTX, mcpUrl: 'https://api.githubcopilot.com/mcp/', clientId: 'gh-id' }
        await exchangeCode(github, 'code')
        await exchangeCode({ ...github, clientId: 'someone-else' }, 'code')
        const secrets = fetchMock.mock.calls.map(call => new URLSearchParams((call as unknown as [string, RequestInit])[1].body as string).get('client_secret'))
        expect(secrets).toEqual(['gh-secret', null])
        vi.unstubAllEnvs()
    })

    it('sends the pre-registered WordPress.com secret to the OAuth 2 token endpoint, the only one that knows its app', async () => {
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_ID', 'wpcom-app')
        vi.stubEnv('RERUN_WORDPRESS_MCP_CLIENT_SECRET', 'wpcom-secret')
        const fetchMock = vi.fn(async () => Response.json({ access_token: 'at', token_type: 'bearer', scope: 'global' }))
        vi.stubGlobal('fetch', fetchMock)
        const wordpress = { ...CTX, mcpUrl: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1', tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token', clientId: 'wpcom-app' }
        await expect(exchangeCode(wordpress, 'code')).resolves.toEqual({ accessToken: 'at', refreshToken: undefined, expiresAt: undefined, scope: 'global' })
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://public-api.wordpress.com/oauth2/token')
        expect(new URLSearchParams(init.body as string).get('client_secret')).toBe('wpcom-secret')
        expect(engineClientSecret(wordpress)).toBeUndefined()
        vi.unstubAllEnvs()
    })

    it('sends the pre-registered Asana secret at the exchange', async () => {
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_ID', 'asana-id')
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_SECRET', 'asana-secret')
        const fetchMock = vi.fn(async () => Response.json({ access_token: 'at' }))
        vi.stubGlobal('fetch', fetchMock)
        await exchangeCode({ ...CTX, mcpUrl: 'https://mcp.asana.com/v2/mcp', clientId: 'asana-id' }, 'code')
        const body = new URLSearchParams((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
        expect(body.get('client_secret')).toBe('asana-secret')
        vi.unstubAllEnvs()
    })

    it('sends the advertised resource, or the server URL for a context that has none', async () => {
        const fetchMock = vi.fn(async () => Response.json({ access_token: 'at' }))
        vi.stubGlobal('fetch', fetchMock)
        await exchangeCode({ ...CTX, mcpUrl: 'https://mcp.browseract.com/mcp/', resource: 'https://mcp.browseract.com/mcp' }, 'code')
        await exchangeCode(CTX, 'code')
        const resources = fetchMock.mock.calls.map(call => new URLSearchParams((call as unknown as [string, RequestInit])[1].body as string).get('resource'))
        expect(resources).toEqual(['https://mcp.browseract.com/mcp', CTX.mcpUrl])
    })

    it('surfaces the start of the error body on a refused exchange', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 })))
        await expect(exchangeCode(CTX, 'x')).rejects.toThrow('token exchange failed (400): invalid_grant')
    })

    it('throws when no access token comes back', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token_type: 'bearer' })))
        await expect(exchangeCode(CTX, 'x')).rejects.toThrow('no access_token')
    })
})

describe('engineClientSecret', () => {
    const ASANA = { ...CTX, mcpUrl: 'https://mcp.asana.com/v2/mcp', clientId: 'asana-id' }
    const GITHUB = { ...CTX, mcpUrl: 'https://api.githubcopilot.com/mcp/', clientId: 'gh-id' }

    beforeEach(() => {
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_ID', 'asana-id')
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_SECRET', 'asana-secret')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', 'gh-id')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_SECRET', 'gh-secret')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('hands the engine the Asana secret, whose hour-long tokens it refreshes on its own', () => {
        expect(engineClientSecret(ASANA)).toBe('asana-secret')
    })

    it('keeps the GitHub secret on the hub, its tokens never expire', () => {
        expect(engineClientSecret(GITHUB)).toBeUndefined()
    })

    it('never hands the Asana secret to another client id or another MCP server', () => {
        expect(engineClientSecret({ ...ASANA, clientId: 'someone-else' })).toBeUndefined()
        expect(engineClientSecret({ ...ASANA, mcpUrl: 'https://mcp.evil.example/mcp' })).toBeUndefined()
    })

    it('hands the engine the Dropbox secret, whose short-lived tokens it refreshes on its own, and to no other client id', () => {
        vi.stubEnv('RERUN_DROPBOX_MCP_CLIENT_ID', 'dropbox-key')
        vi.stubEnv('RERUN_DROPBOX_MCP_CLIENT_SECRET', 'dropbox-secret')
        expect(engineClientSecret({ mcpUrl: DROPBOX_MCP, clientId: 'dropbox-key' })).toBe('dropbox-secret')
        expect(engineClientSecret({ mcpUrl: DROPBOX_MCP, clientId: 'someone-else' })).toBeUndefined()
    })

    it('passes a dynamically registered secret through', () => {
        expect(engineClientSecret({ ...CTX, clientSecret: 'dcr-secret' })).toBe('dcr-secret')
    })

    it('answers from the MCP URL and client id alone, all a parked bundle still knows', () => {
        expect(engineClientSecret({ mcpUrl: ASANA.mcpUrl, clientId: 'asana-id' })).toBe('asana-secret')
        expect(engineClientSecret({ mcpUrl: ASANA.mcpUrl })).toBeUndefined()
    })
})

describe('encodeContext / decodeContext', () => {
    beforeEach(() => {
        vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('round-trips the context, unicode included', () => {
        const ctx = { ...CTX, serverName: 'Notion été', mobileGrant: 'g' }
        expect(decodeContext(encodeContext(ctx))).toEqual(ctx)
    })

    it('throws on a cookie that is not an encoded context', () => {
        expect(() => decodeContext('not-json')).toThrow()
    })
})
