import { assertPublicUrl, fetchPublic } from '@/lib/net/public-fetch'
import { openContext, sealContext } from '@/lib/oauth/context-cookie'
import { createHash, randomBytes } from 'node:crypto'

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function base64url(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const OAUTH_COOKIE_PREFIX = 'mcp_oauth_'
export const OAUTH_COOKIE_PATH = '/api/mcp/oauth'

export type OAuthContext = {
    verifier: string
    agentId: string
    serverName: string
    mcpUrl: string
    tokenEndpoint: string
    clientId: string
    clientSecret?: string
    redirectUri: string
    mobileGrant?: string
}

export type DiscoveredMetadata = {
    authorizationEndpoint: string
    tokenEndpoint: string
    registrationEndpoint?: string
    scopesSupported?: string[]
    clientIdMetadataDocumentSupported?: boolean
}

export type ClientInfo = { clientId: string; clientSecret?: string }

function appOrigin(req: Request): string {
    const h = req.headers
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
    const local = host.startsWith('localhost') || host.startsWith('127.')
    const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
    return `${proto}://${host}`
}

export function callbackUrl(req: Request): string {
    return `${appOrigin(req)}${OAUTH_COOKIE_PATH}/callback`
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
    try {
        const res = await fetchPublic(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) return null
        return (await res.json()) as Record<string, unknown>
    } catch {
        return null
    }
}

function authServerMetadataUrls(issuer: string): string[] {
    const u = new URL(issuer)
    const path = trimSlash(u.pathname)
    const urls: string[] = []
    if (path) {
        urls.push(`${u.origin}/.well-known/oauth-authorization-server${path}`)
        urls.push(`${u.origin}/.well-known/openid-configuration${path}`)
        urls.push(`${u.origin}${path}/.well-known/openid-configuration`)
    }
    urls.push(`${u.origin}/.well-known/oauth-authorization-server`)
    urls.push(`${u.origin}/.well-known/openid-configuration`)
    return urls
}

const TWO_LABEL_PUBLIC_SUFFIX = /^(?:co|com|net|org|gov|edu|ac)\.[a-z]{2}$/

function parentOrigins(origin: string): string[] {
    const labels = new URL(origin).hostname.split('.')
    const origins: string[] = []
    for (let i = 1; labels.length - i >= 2; i++) {
        const parent = labels.slice(i).join('.')
        if (TWO_LABEL_PUBLIC_SUFFIX.test(parent)) break
        origins.push(`https://${parent}`)
    }
    return origins
}

function registrableDomain(hostname: string): string {
    const labels = hostname.split('.')
    const parent = labels.slice(-2).join('.')
    return TWO_LABEL_PUBLIC_SUFFIX.test(parent) ? labels.slice(-3).join('.') : parent
}

async function endpointOnSite(value: unknown, label: string, sites: URL[]): Promise<string> {
    if (typeof value !== 'string') throw new Error(`this server advertises no ${label}`)
    const parsed = await assertPublicUrl(value)
    if (!sites.some(site => registrableDomain(site.hostname) === registrableDomain(parsed.hostname))) throw new Error(`the ${label} of this server points away from it (${parsed.host})`)
    return value
}

export async function discoverAuthServer(mcpUrl: string): Promise<DiscoveredMetadata> {
    const url = await assertPublicUrl(mcpUrl)
    const origin = url.origin
    const path = trimSlash(url.pathname)
    const prm =
        (path ? await fetchJson(`${origin}/.well-known/oauth-protected-resource${path}`) : null) ??
        (await fetchJson(`${origin}/.well-known/oauth-protected-resource`))
    const servers = prm?.authorization_servers as string[] | undefined
    const bases = servers?.length ? [servers[0]] : [origin, ...parentOrigins(origin)]
    const resourceScopes = Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as string[]) : undefined
    let meta: Record<string, unknown> | null = null
    let foundAt: string | null = null
    for (const base of bases) {
        for (const candidate of authServerMetadataUrls(base)) {
            const found = await fetchJson(candidate)
            if (found && typeof found.authorization_endpoint === 'string' && typeof found.token_endpoint === 'string') {
                meta = found
                foundAt = base
                break
            }
        }
        if (meta) break
    }
    if (!meta || !foundAt) {
        throw new Error('this server does not advertise an OAuth authorization server')
    }
    const sites = [url, new URL(foundAt)]
    return {
        authorizationEndpoint: await endpointOnSite(meta.authorization_endpoint, 'authorization endpoint', sites),
        tokenEndpoint: await endpointOnSite(meta.token_endpoint, 'token endpoint', sites),
        registrationEndpoint: typeof meta.registration_endpoint === 'string' ? await endpointOnSite(meta.registration_endpoint, 'registration endpoint', sites) : undefined,
        scopesSupported: resourceScopes ?? (Array.isArray(meta.scopes_supported) ? (meta.scopes_supported as string[]) : undefined),
        clientIdMetadataDocumentSupported: meta.client_id_metadata_document_supported === true,
    }
}

export function clientMetadataDocumentUrl(req: Request): string {
    return `${appOrigin(req)}${OAUTH_COOKIE_PATH}/client-metadata`
}

export function clientMetadataDocument(req: Request): Record<string, unknown> {
    return {
        client_id: clientMetadataDocumentUrl(req),
        client_name: 'Rerun',
        client_uri: appOrigin(req),
        redirect_uris: [callbackUrl(req)],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    }
}

export async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<ClientInfo> {
    const res = await fetchPublic(registrationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_name: 'Rerun',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    })
    if (!res.ok) throw new Error(`client registration failed (${res.status})`)
    const data = (await res.json()) as { client_id?: string; client_secret?: string }
    if (!data.client_id) throw new Error('client registration returned no client_id')
    return { clientId: data.client_id, clientSecret: data.client_secret }
}

type PreRegisteredClient = { mcpOrigin: string; clientIdEnv: string; clientSecretEnv: string; engineRefreshes?: boolean }

const PRE_REGISTERED_CLIENTS: PreRegisteredClient[] = [
    { mcpOrigin: 'https://api.githubcopilot.com', clientIdEnv: 'RERUN_GITHUB_MCP_CLIENT_ID', clientSecretEnv: 'RERUN_GITHUB_MCP_CLIENT_SECRET' },
    { mcpOrigin: 'https://mcp.asana.com', clientIdEnv: 'RERUN_ASANA_MCP_CLIENT_ID', clientSecretEnv: 'RERUN_ASANA_MCP_CLIENT_SECRET', engineRefreshes: true },
]

const CLIENT_METADATA_DOCUMENT_FIRST = ['https://mcp.heygen.com']

function preRegisteredClient(mcpUrl: string): { clientId: string; clientSecret: string; engineRefreshes: boolean } | null {
    const origin = new URL(mcpUrl).origin
    const entry = PRE_REGISTERED_CLIENTS.find(client => client.mcpOrigin === origin)
    const clientId = entry && process.env[entry.clientIdEnv]
    const clientSecret = entry && process.env[entry.clientSecretEnv]
    return clientId && clientSecret ? { clientId, clientSecret, engineRefreshes: entry.engineRefreshes === true } : null
}

export async function resolveClient(metadata: DiscoveredMetadata, mcpUrl: string, req: Request): Promise<ClientInfo | null> {
    const preRegistered = preRegisteredClient(mcpUrl)
    if (preRegistered) return { clientId: preRegistered.clientId }

    if (metadata.clientIdMetadataDocumentSupported && CLIENT_METADATA_DOCUMENT_FIRST.includes(new URL(mcpUrl).origin)) {
        return { clientId: clientMetadataDocumentUrl(req) }
    }

    if (metadata.registrationEndpoint) {
        try {
            return await registerClient(metadata.registrationEndpoint, callbackUrl(req))
        } catch (err) {
            if (!metadata.clientIdMetadataDocumentSupported) throw err
        }
    }
    return metadata.clientIdMetadataDocumentSupported ? { clientId: clientMetadataDocumentUrl(req) } : null
}

type ClientRef = { mcpUrl: string; clientId?: string; clientSecret?: string }

function clientSecret(ref: ClientRef, forEngine: boolean): string | undefined {
    if (ref.clientSecret) return ref.clientSecret
    const preRegistered = preRegisteredClient(ref.mcpUrl)
    if (!preRegistered || preRegistered.clientId !== ref.clientId) return undefined
    return forEngine && !preRegistered.engineRefreshes ? undefined : preRegistered.clientSecret
}

function clientSecretFor(ref: ClientRef): string | undefined {
    return clientSecret(ref, false)
}

export function engineClientSecret(ref: ClientRef): string | undefined {
    return clientSecret(ref, true)
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(24))
    return { verifier, challenge, state }
}

export function buildAuthorizeUrl(metadata: DiscoveredMetadata, ctx: OAuthContext, challenge: string, state: string): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: ctx.clientId,
        redirect_uri: ctx.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: ctx.mcpUrl,
    })
    const scope = metadata.scopesSupported?.join(' ')
    if (scope) params.set('scope', scope)
    return `${metadata.authorizationEndpoint}?${params.toString()}`
}

export type ExchangedToken = { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }

export async function exchangeCode(ctx: OAuthContext, code: string): Promise<ExchangedToken> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ctx.redirectUri,
        client_id: ctx.clientId,
        code_verifier: ctx.verifier,
        resource: ctx.mcpUrl,
    })
    const clientSecret = clientSecretFor(ctx)
    if (clientSecret) body.set('client_secret', clientSecret)
    const res = await fetchPublic(ctx.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`token exchange failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
    if (!data.access_token) throw new Error('no access_token in response')
    return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
        expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
        scope: typeof data.scope === 'string' ? data.scope : undefined,
    }
}

export function encodeContext(ctx: OAuthContext): string {
    return sealContext(ctx)
}

export function decodeContext(raw: string): OAuthContext {
    return openContext<OAuthContext>(raw)
}
