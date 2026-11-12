import { parseServiceRegistryKey } from '@rerun/contracts'
import { workspaceActor } from '@/app/api/_auth/access'
import { getCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import { getServiceDetails, loadManifest } from '@/app/api/_services/services.service'
import { composioConfigured, composioUserId, initiateConnectedAccount } from '@/lib/composio/client'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, composioCallbackUrl, createComposioState, encodeComposioContext } from '@/lib/composio/oauth'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, type OAuthContext, buildAuthorizeUrl, callbackUrl, createPkce, discoverAuthServer, encodeContext, resolveClient } from '@/lib/mcp-oauth'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { mintCallbackGrant, verifyConnectTicket, type ConnectTicket } from '@/lib/oauth/mobile-ticket'
import { openPendingGrant } from '@/lib/oauth/pending-grant'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Cookie = { name: string; value: string; path: string }

function redirect(url: string, cookie?: Cookie): NextResponse {
    const res = new NextResponse(null, { status: 302, headers: { Location: url } })
    if (cookie) res.cookies.set(cookie.name, cookie.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: cookie.path, maxAge: 600 })
    return res
}

async function mcpOAuthRedirect(req: Request, target: { agentId: string; serverName: string; url: string; mobileGrant: string }): Promise<NextResponse> {
    const metadata = await discoverAuthServer(target.url)
    const clientInfo = await resolveClient(metadata, target.url, req)
    if (!clientInfo?.clientId) throw new Error('No OAuth client available for this provider')

    const { verifier, challenge, state } = createPkce()
    const ctx: OAuthContext = {
        verifier,
        agentId: target.agentId,
        serverName: target.serverName,
        mcpUrl: target.url,
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret,
        redirectUri: callbackUrl(req),
        scope: metadata.scopesSupported?.join(' '),
        mobileGrant: target.mobileGrant,
    }
    return redirect(buildAuthorizeUrl(metadata, ctx, challenge, state), { name: OAUTH_COOKIE_PREFIX + state, value: encodeContext(ctx), path: OAUTH_COOKIE_PATH })
}

// The sign-in entry point for the iOS app. The app opens it inside the auth session rather than
// fetching it, so the one-request PKCE cookie lands in the browser's own jar and the callback can
// read it back, exactly like the web popup. A signed capability ticket stands in for the session
// the in-app browser does not carry.
export async function GET(req: Request) {
    let ticket: ConnectTicket
    try {
        ticket = verifyConnectTicket(new URL(req.url).searchParams.get('t'))
    } catch (err) {
        return redirect(appReturnUrl({ ok: false, error: err instanceof Error ? err.message : 'Invalid sign-in ticket' }))
    }

    const { agentId, workspaceId, userId, jti } = ticket
    // The ticket is only minted for someone who manages the coworker's Box, and its claim checks that again.
    const actor = workspaceActor(workspaceId)
    try {
        // The ticket is spent here: the row it opens is where the callback parks the token, and what
        // the app claims afterwards with its bearer.
        await openPendingGrant(ticket)
        const mobileGrant = mintCallbackGrant({ agentId, workspaceId, userId, jti, desktop: ticket.desktop })

        // The server's url is read off the agent now, never carried from the app: it is where the
        // token will be sent.
        if (ticket.server !== undefined) {
            const custom = await getCustomMcpServer(agentId, ticket.server, actor)
            if (!custom?.server.signInUrl) throw new Error(`${ticket.server} has no sign-in to open from here.`)
            return await mcpOAuthRedirect(req, { agentId, serverName: custom.server.name, url: custom.server.signInUrl, mobileGrant })
        }

        const key = ticket.key
        // The registry is the only source of truth for what signing in means here, so the target is
        // read now rather than carried from the app.
        const details = await getServiceDetails(agentId, key, actor)

        if (details.managed) {
            const provider = getManagedProvider(details.managed.provider)
            if (!provider) throw new Error(`Unknown provider: ${details.managed.provider}`)
            const clientId = process.env[provider.oauth.clientIdEnv]
            if (!clientId) throw new Error(`${provider.label} is not configured on this server.`)

            const { verifier, challenge, state } = createPkceState()
            const ctx: ManagedOAuthContext = { verifier, agentId, key, provider: details.managed.provider, serverName: details.managed.serverName, redirectUri: managedCallbackUrl(req, details.managed.provider), mobileGrant }
            return redirect(buildManagedAuthorizeUrl(provider.oauth, clientId, ctx, challenge, state), { name: MANAGED_COOKIE_PREFIX + state, value: encodeManagedContext(ctx), path: MANAGED_COOKIE_PATH })
        }

        if (details.composio) {
            if (!composioConfigured()) throw new Error('Composio connections are not configured on this server.')
            const manifest = await loadManifest(key)
            const method = manifest?.authMethods.find(m => m.kind === 'composio' && m.composio)
            if (!method?.composio) throw new Error(`${details.name} has no Composio connection to set up.`)

            const state = createComposioState()
            const userId = composioUserId(agentId, parseServiceRegistryKey(key).instanceId)
            const { connectedAccountId, redirectUrl } = await initiateConnectedAccount(userId, method.composio.authConfigId, composioCallbackUrl(req, state))
            const ctx: ComposioOAuthContext = { agentId, key, toolkit: method.composio.toolkit, serverName: details.composio.serverName, connectedAccountId, mobileGrant }
            return redirect(redirectUrl, { name: COMPOSIO_COOKIE_PREFIX + state, value: encodeComposioContext(ctx), path: COMPOSIO_COOKIE_PATH })
        }

        if (details.oauth) return await mcpOAuthRedirect(req, { agentId, serverName: details.oauth.serverName, url: details.oauth.url, mobileGrant })

        throw new Error(`${details.name} has no sign-in waiting.`)
    } catch (err) {
        return redirect(appReturnUrl({ ok: false, error: err instanceof Error ? err.message : 'Could not start the sign-in' }, ticket.desktop))
    }
}
