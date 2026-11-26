import { assertAgentAccess, signedInUserId, type Actor } from '@/app/api/_auth/access'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { getBrand } from '@/lib/brand/server'
import { getVaultItem } from '@/lib/engine/vault-client'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, type OAuthContext, buildAuthorizeUrl, callbackUrl, createPkce, discoverAuthServer, encodeContext, isPreRegistered, resolveClient } from '@/lib/mcp-oauth'
import { requestHostReturn, startOnRerunHost } from '@/lib/oauth/host-sign-in'
import { signInRefusal } from '@/lib/net/network-error'
import { refusal } from '@/lib/i18n/action-error'
import { NextResponse } from 'next/server'

// Build the PKCE authorize URL and stash the one-request context (verifier + endpoints +
// client) in an httpOnly cookie keyed by state, so /callback can finish and later refresh.
// The endpoints and the client come from a discovery run here, never from the caller: the
// callback POSTs the code to that token endpoint and the engine later sends the refresh token there.
export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { agentId?: string; vaultItemId?: string; serverName: string; mcpUrl: string }
        const { serverName } = body
        let { mcpUrl } = body
        const agentId = body.agentId ?? ''
        let vault: OAuthContext['vault']
        let workspaceId: number | undefined
        let starter: Actor
        if (body.vaultItemId) {
            // An entry signs in where it was compiled to: its own server and address, never the caller's.
            const ctx = await vaultContext()
            await assertCanAdd(ctx.actor)
            const item = await getVaultItem(ctx.conn, body.vaultItemId)
            if (!item.oauth || item.oauth.serverName !== serverName) return NextResponse.json(refusal('vaultEntryOtherServer'), { status: 400 })
            mcpUrl = item.oauth.url
            vault = { itemId: item.id, workspaceId: ctx.actor.workspaceId }
            starter = ctx.actor
        } else {
            starter = (await assertAgentAccess(agentId, 'manage')).actor
            workspaceId = starter.workspaceId
        }

        const from = isPreRegistered(mcpUrl) ? await requestHostReturn(req) : null
        if (from) return startOnRerunHost(from, { agentId: vault ? '' : agentId, workspaceId: starter.workspaceId, userId: signedInUserId(starter) }, { flow: 'mcp', serverName, mcpUrl, ...(vault ? { vaultItem: vault.itemId } : {}) })

        const discovered = await discoverAuthServer(mcpUrl)
        const clientInfo = await resolveClient(discovered, mcpUrl, req, (await getBrand()).name)

        if (!clientInfo?.clientId) return NextResponse.json(refusal('noOAuthClient'), { status: 400 })
        const metadata = { ...discovered, ...clientInfo.signIn }

        const { verifier, challenge, state } = createPkce()
        const ctx: OAuthContext = {
            verifier,
            agentId,
            serverName,
            mcpUrl,
            resource: discovered.resource,
            tokenEndpoint: metadata.tokenEndpoint,
            clientId: clientInfo.clientId,
            clientSecret: clientInfo.clientSecret,
            redirectUri: callbackUrl(req),
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(vault ? { vault } : {}),
        }

        const res = NextResponse.json({ authorizationUrl: buildAuthorizeUrl(metadata, ctx, challenge, state) })
        res.cookies.set(OAUTH_COOKIE_PREFIX + state, encodeContext(ctx), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: OAUTH_COOKIE_PATH,
            maxAge: 600,
        })
        return res
    } catch (err) {
        return NextResponse.json(signInRefusal(err, 'startOAuthFailed'), { status: 400 })
    }
}
