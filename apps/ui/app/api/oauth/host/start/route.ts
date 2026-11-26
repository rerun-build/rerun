import { APP_URL } from '@/lib/app-url'
import { isRerunHost } from '@/lib/brand/request-site'
import { refusal, refusalOf } from '@/lib/i18n/action-error'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl, type ManagedOAuthContext } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, buildAuthorizeUrl, callbackUrl, createPkce, discoverAuthServer, encodeContext, isPreRegistered, resolveClient, type OAuthContext } from '@/lib/mcp-oauth'
import { AppError } from '@/lib/i18n/action-error'
import { openHostTicket, returnToHost, type HostReturn } from '@/lib/oauth/host-sign-in'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type ContextCookie = { name: string; value: string; path: string }

function toProvider(url: string, cookie: ContextCookie): NextResponse {
    const res = new NextResponse(null, { status: 302, headers: { Location: url, 'Referrer-Policy': 'no-referrer' } })
    res.cookies.set(cookie.name, cookie.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: cookie.path, maxAge: 600 })
    return res
}

// The callbacks come back to Rerun's own address, which is the one the providers were given.
const onRerunHost = () => new Request(APP_URL, { headers: { host: new URL(APP_URL).host, 'x-forwarded-proto': new URL(APP_URL).protocol.replace(':', '') } })

async function startManaged(back: HostReturn, target: Extract<HostReturn['target'], { flow: 'managed' }>): Promise<NextResponse> {
    const provider = getManagedProvider(target.provider)
    if (!provider) throw new AppError('unknownOAuthProvider', { provider: target.provider })
    const clientId = process.env[provider.oauth.clientIdEnv]
    if (!clientId) throw new AppError('providerNotConfigured', { provider: provider.label })

    const { verifier, challenge, state } = createPkceState()
    const ctx: ManagedOAuthContext = { verifier, agentId: back.agentId, key: target.key, provider: target.provider, serverName: target.serverName, redirectUri: managedCallbackUrl(onRerunHost(), target.provider), workspaceId: back.workspaceId, host: back }
    return toProvider(buildManagedAuthorizeUrl(provider.oauth, clientId, ctx, challenge, state), { name: MANAGED_COOKIE_PREFIX + state, value: encodeManagedContext(ctx), path: MANAGED_COOKIE_PATH })
}

async function startMcp(back: HostReturn, target: Extract<HostReturn['target'], { flow: 'mcp' }>): Promise<NextResponse> {
    if (!isPreRegistered(target.mcpUrl)) throw new AppError('noOAuthClient')
    const discovered = await discoverAuthServer(target.mcpUrl)
    const client = await resolveClient(discovered, target.mcpUrl, onRerunHost())
    if (!client) throw new AppError('noOAuthClient')
    const metadata = { ...discovered, ...client.signIn }

    const { verifier, challenge, state } = createPkce()
    const ctx: OAuthContext = { verifier, agentId: back.agentId, serverName: target.serverName, mcpUrl: target.mcpUrl, resource: discovered.resource, tokenEndpoint: metadata.tokenEndpoint, clientId: client.clientId, redirectUri: callbackUrl(onRerunHost()), workspaceId: back.workspaceId, host: back }
    return toProvider(buildAuthorizeUrl(metadata, ctx, challenge, state), { name: OAUTH_COOKIE_PREFIX + state, value: encodeContext(ctx), path: OAUTH_COOKIE_PATH })
}

// Opened by the popup of an organization's address, with the ticket its start signed. Whoever holds it
// may connect what it names: that was checked there, where they have a session.
export async function GET(req: Request) {
    if (!(await isRerunHost())) return new NextResponse('Not found', { status: 404 })
    let back: HostReturn
    try {
        back = await openHostTicket(new URL(req.url).searchParams.get('t'))
    } catch {
        return new NextResponse(refusal('signInExpired').error, { status: 400 })
    }
    try {
        return back.target.flow === 'managed' ? await startManaged(back, back.target) : await startMcp(back, back.target)
    } catch (err) {
        return returnToHost(back, { ok: false, ...refusalOf(err, 'startOAuthFailed') })
    }
}
