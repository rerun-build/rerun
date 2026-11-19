import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedOAuthConfig } from '@/lib/managed/types'
import { type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, decodeManagedContext, encodeManagedContext, exchangeManagedCode, managedCallbackUrl } from './oauth'

const CFG: ManagedOAuthConfig = {
    authorizationEndpoint: 'https://typeform.example/oauth/authorize',
    tokenEndpoint: 'https://typeform.example/oauth/token',
    scopes: ['forms:read', 'responses:read'],
    clientIdEnv: 'X',
    clientSecretEnv: 'Y',
}

const CTX: ManagedOAuthContext = { verifier: 'ver', agentId: 'a1', key: 'typeform', provider: 'typeform', serverName: 'Typeform', redirectUri: 'https://moldwright.robagentic.tech/api/oauth/managed/typeform/callback' }

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('managedCallbackUrl', () => {
    it('puts the provider in the path under the forwarded origin', () => {
        const req = new Request('http://internal/', { headers: { 'x-forwarded-host': 'moldwright.robagentic.tech', 'x-forwarded-proto': 'https' } })
        expect(managedCallbackUrl(req, 'typeform')).toBe('https://moldwright.robagentic.tech/api/oauth/managed/typeform/callback')
    })

    it('answers over http on a local host', () => {
        expect(managedCallbackUrl(new Request('http://x/', { headers: { host: '127.0.0.1:3000' } }), 'p')).toBe('http://127.0.0.1:3000/api/oauth/managed/p/callback')
    })
})

describe('createPkceState', () => {
    it('makes a fresh verifier and state on every call', () => {
        const a = createPkceState()
        const b = createPkceState()
        expect(a.verifier).not.toBe(b.verifier)
        expect(a.state).not.toBe(b.state)
        expect(a.challenge).not.toBe(a.verifier)
    })
})

describe('buildManagedAuthorizeUrl', () => {
    it('joins the scopes with spaces and lets the provider params override the defaults', () => {
        const url = new URL(buildManagedAuthorizeUrl({ ...CFG, authorizeParams: { access_type: 'offline', response_type: 'token' } }, 'cid', CTX, 'chal', 'st'))
        expect(url.origin + url.pathname).toBe(CFG.authorizationEndpoint)
        expect(url.searchParams.get('scope')).toBe('forms:read responses:read')
        expect(url.searchParams.get('access_type')).toBe('offline')
        expect(url.searchParams.get('response_type')).toBe('token')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    })

    it('leaves the scope out when the provider grants permissions through its own config', () => {
        const url = new URL(buildManagedAuthorizeUrl({ ...CFG, scopes: [], authorizeParams: { config_id: '42' } }, 'cid', CTX, 'chal', 'st'))
        expect(url.searchParams.has('scope')).toBe(false)
        expect(url.searchParams.get('config_id')).toBe('42')
    })
})

describe('exchangeManagedCode', () => {
    it('sends the fixed client secret with the verifier and computes the expiry', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(0)
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 10 }))
        vi.stubGlobal('fetch', fetchMock)
        await expect(exchangeManagedCode(CFG, 'cid', 'secret', CTX, 'code')).resolves.toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 10_000, scope: undefined })
        const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
        expect(Object.fromEntries(body)).toMatchObject({ client_secret: 'secret', code_verifier: 'ver', code: 'code' })
    })

    it('cuts the error body to 200 characters', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(500), { status: 401 })))
        await expect(exchangeManagedCode(CFG, 'cid', 's', CTX, 'code')).rejects.toThrow(new Error(`token exchange failed (401): ${'x'.repeat(200)}`))
    })

    it('throws when the token response has no access token', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})))
        await expect(exchangeManagedCode(CFG, 'cid', 's', CTX, 'code')).rejects.toThrow('no access_token')
    })
})

describe('encodeManagedContext', () => {
    it('round-trips through decodeManagedContext', () => {
        vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
        const ctx = { ...CTX, mobileGrant: 'grant' }
        expect(decodeManagedContext(encodeManagedContext(ctx))).toEqual(ctx)
        vi.unstubAllEnvs()
    })
})
