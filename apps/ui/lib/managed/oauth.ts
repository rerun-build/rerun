// Managed OAuth: the authorization-code + PKCE flow for a provider whose client is Rerun's
// own (a single app, credentials in env), so the user never registers anything with the
// provider. Runs on rerun.build because it has the TLS domain + registered redirect_uri the
// raw-IP engine lacks. The resulting token is handed to the ENGINE token store (never
// Supabase), exactly like lib/mcp-oauth.ts, but with a fixed client instead of discovery/DCR.
//
// Server-only. Import from route handlers.

import type { ManagedOAuthConfig } from '@/lib/managed/types'
import { base64url } from '@/lib/mcp-oauth'
import { openContext, sealContext } from '@/lib/oauth/context-cookie'
import { createHash, randomBytes } from 'node:crypto'

export const MANAGED_COOKIE_PREFIX = 'managed_oauth_'
export const MANAGED_COOKIE_PATH = '/api/oauth/managed'

// One-request PKCE + install context, round-tripped through an httpOnly cookie keyed by
// `state` between /start and /callback. Holds no long-lived secret.
export type ManagedOAuthContext = {
    verifier: string
    agentId: string
    // Registry key of the entry being connected: the bare slug, or `<slug>@<instanceId>`.
    key: string
    provider: string
    serverName: string
    redirectUri: string
    // The workspace of the tab that started the sign-in. The callback's popup names none, and the
    // Chief of Staff has no row to name its own.
    workspaceId?: number
    // Started from the iOS app: the callback redirects back into it instead of answering with the
    // popup page, and reads the workspace from this signed grant since that browser has no session.
    mobileGrant?: string
}

export function createPkceState(): { verifier: string; challenge: string; state: string } {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(24))
    return { verifier, challenge, state }
}

export function appOrigin(req: Request): string {
    const h = req.headers
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
    const local = host.startsWith('localhost') || host.startsWith('127.')
    const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')
    return `${proto}://${host}`
}

// The redirect target, derived identically in /start and /callback so they always agree.
// Must match a redirect URI registered on the provider's OAuth client.
export function managedCallbackUrl(req: Request, provider: string): string {
    return `${appOrigin(req)}${MANAGED_COOKIE_PATH}/${provider}/callback`
}

export function buildManagedAuthorizeUrl(cfg: ManagedOAuthConfig, clientId: string, ctx: ManagedOAuthContext, challenge: string, state: string): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: ctx.redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(cfg.scopes.length ? { scope: cfg.scopes.join(' ') } : {}),
        ...(cfg.authorizeParams ?? {}),
    })
    return `${cfg.authorizationEndpoint}?${params.toString()}`
}

export type ManagedToken = { accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }

export async function exchangeManagedCode(cfg: ManagedOAuthConfig, clientId: string, clientSecret: string, ctx: ManagedOAuthContext, code: string): Promise<ManagedToken> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ctx.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: ctx.verifier,
    })
    const res = await fetch(cfg.tokenEndpoint, {
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

export function encodeManagedContext(ctx: ManagedOAuthContext): string {
    return sealContext(ctx)
}

export function decodeManagedContext(raw: string): ManagedOAuthContext {
    return openContext<ManagedOAuthContext>(raw)
}
