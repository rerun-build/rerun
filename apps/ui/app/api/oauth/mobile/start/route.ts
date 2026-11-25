import { workspaceActor } from '@/app/api/_auth/access'
import { getCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import { getServiceDetails, loadManifest } from '@/app/api/_services/services.service'
import { composioConfigured, initiateConnectedAccount } from '@/lib/composio/client'
import { composioUserForKey } from '@/lib/vault/composio'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, composioCallbackUrl, createComposioState, encodeComposioContext } from '@/lib/composio/oauth'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, type OAuthContext, buildAuthorizeUrl, callbackUrl, createPkce, discoverAuthServer, encodeContext, resolveClient } from '@/lib/mcp-oauth'
import { appReturnUrl } from '@/lib/oauth/app-return'
import { mintCallbackGrant, verifyConnectTicket, type ConnectTicket } from '@/lib/oauth/mobile-ticket'
import { openPendingGrant, purgeExpiredGrants } from '@/lib/oauth/pending-grant'
import { beginVaultComposio, beginVaultManaged, discardVaultComposioAccount } from '@/app/api/_services/vault-sign-in.service'
import { vaultContext } from '@/app/api/_services/vault.service'
import { type ContextCookie, setContextCookie } from '@/lib/oauth/context-cookie'
import { getVaultItem } from '@/lib/engine/vault-client'
import { AppError } from '@/lib/i18n/action-error'
import { after, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function redirect(url: string, cookie?: ContextCookie): NextResponse {
    const res = new NextResponse(null, { status: 302, headers: { Location: url } })
    return cookie ? setContextCookie(res, cookie) : res
}

// A sign-in nobody came back to claim leaves with its row.
async function dropUnclaimedSignIns(): Promise<void> {
    try {
        await Promise.all((await purgeExpiredGrants()).map(discardVaultComposioAccount))
    } catch (err) {
        console.warn('[oauth] expired sign-ins left in place:', err instanceof Error ? err.message : err)
    }
}

async function mcpOAuthRedirect(req: Request, target: { agentId: string; serverName: string; url: string; mobileGrant: string; vault?: OAuthContext['vault'] }): Promise<NextResponse> {
    const discovered = await discoverAuthServer(target.url)
    const clientInfo = await resolveClient(discovered, target.url, req)
    if (!clientInfo?.clientId) throw new Error('No OAuth client available for this provider')
    const metadata = { ...discovered, ...clientInfo.signIn }

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
        mobileGrant: target.mobileGrant,
        ...(target.vault ? { vault: target.vault } : {}),
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

    after(dropUnclaimedSignIns)

    const { agentId, workspaceId, userId, jti } = ticket
    // The ticket is only minted for someone who manages the coworker's Box, or who may add to the Vault
    // for an entry, and its claim checks that again.
    const actor = workspaceActor(workspaceId)
    try {
        // The ticket is spent here: the row it opens is where the callback parks the token, and what
        // the app claims afterwards with its bearer.
        await openPendingGrant(ticket)
        const mobileGrant = mintCallbackGrant({ agentId, vaultItem: ticket.vaultItem, workspaceId, userId, jti, desktop: ticket.desktop })

        if (ticket.vaultItem !== undefined) {
            const { conn } = await vaultContext(actor)
            const item = await getVaultItem(conn, ticket.vaultItem)
            const brokered = item.composio ? await beginVaultComposio(req, workspaceId, item, mobileGrant) : item.managed ? await beginVaultManaged(req, workspaceId, item, mobileGrant) : null
            if (brokered) return redirect(brokered.url, brokered.cookie)
            if (!item.oauth) throw new AppError('vaultEntryOtherServer')
            return await mcpOAuthRedirect(req, { agentId, serverName: item.oauth.serverName, url: item.oauth.url, mobileGrant, vault: { itemId: item.id, workspaceId } })
        }

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
            const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'manage', actor)
            const userId = await composioUserForKey(conn, workspaceId, engineAgentId, agentId, key)
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
