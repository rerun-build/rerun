import { assertAgentInWorkspace } from '@/app/api/_auth/access'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { getVaultItem } from '@/lib/engine/vault-client'
import { OAUTH_COOKIE_PATH, OAUTH_COOKIE_PREFIX, type OAuthContext, buildAuthorizeUrl, callbackUrl, createPkce, discoverAuthServer, encodeContext, resolveClient } from '@/lib/mcp-oauth'
import { describeSignInError } from '@/lib/net/network-error'
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
        if (body.vaultItemId) {
            // An entry signs in where it was compiled to: its own server and address, never the caller's.
            const ctx = await vaultContext()
            await assertCanAdd(ctx.actor)
            const item = await getVaultItem(ctx.conn, body.vaultItemId)
            if (!item.oauth || item.oauth.serverName !== serverName) return NextResponse.json({ error: 'This entry does not sign in through this server' }, { status: 400 })
            mcpUrl = item.oauth.url
            vault = { itemId: item.id, workspaceId: ctx.actor.workspaceId }
        } else {
            await assertAgentInWorkspace(agentId, 'manage')
        }

        const metadata = await discoverAuthServer(mcpUrl)
        const clientInfo = await resolveClient(metadata, mcpUrl, req)

        if (!clientInfo?.clientId) return NextResponse.json({ error: 'No OAuth client available for this provider' }, { status: 400 })

        const { verifier, challenge, state } = createPkce()
        const ctx: OAuthContext = {
            verifier,
            agentId,
            serverName,
            mcpUrl,
            tokenEndpoint: metadata.tokenEndpoint,
            clientId: clientInfo.clientId,
            clientSecret: clientInfo.clientSecret,
            redirectUri: callbackUrl(req),
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
        return NextResponse.json({ error: describeSignInError(err, 'Failed to start OAuth') }, { status: 400 })
    }
}
