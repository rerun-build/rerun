import { assertAgentOrForemanAccess } from '@/app/api/_auth/access'
import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { readRegistry, resolveRegistryEntry } from '@/lib/services/registry'
import { signInRefusal } from '@/lib/net/network-error'
import { refusal } from '@/lib/i18n/action-error'
import { NextResponse } from 'next/server'

// Begin the managed OAuth flow: build the authorize URL for Rerun's own client and stash the
// one-request PKCE context in an httpOnly cookie keyed by state, so /callback can finish it.
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
    try {
        const { provider: providerId } = await params
        const provider = getManagedProvider(providerId)
        if (!provider) return NextResponse.json(refusal('unknownOAuthProvider', { provider: providerId }), { status: 404 })

        const body = (await req.json()) as { agentId: string; key?: string; slug?: string; serverName?: string }
        const { agentId } = body
        const key = body.key ?? body.slug ?? ''
        const actor = await assertAgentOrForemanAccess(agentId, 'manage')

        // The token is stored under this name and the compiled server reads it back from there, so
        // the registry entry wins over whatever the page sent.
        const { conn, engineAgentId } = await getAgentChatTarget(agentId, 'manage', actor)
        const entry = resolveRegistryEntry(await readRegistry(conn, engineAgentId), key)?.entry
        const serverName = entry?.managed?.serverName || body.serverName
        if (!serverName) return NextResponse.json(refusal('noProviderConnectionToSetUp', { key, provider: provider.label }), { status: 400 })

        const clientId = process.env[provider.oauth.clientIdEnv]
        if (!clientId) return NextResponse.json(refusal('providerNotConfigured', { provider: provider.label }), { status: 400 })

        const { verifier, challenge, state } = createPkceState()
        const ctx: ManagedOAuthContext = {
            verifier,
            agentId,
            key,
            provider: providerId,
            serverName,
            redirectUri: managedCallbackUrl(req, providerId),
        }

        const res = NextResponse.json({ authorizationUrl: buildManagedAuthorizeUrl(provider.oauth, clientId, ctx, challenge, state) })
        res.cookies.set(MANAGED_COOKIE_PREFIX + state, encodeManagedContext(ctx), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: MANAGED_COOKIE_PATH,
            maxAge: 600,
        })
        return res
    } catch (err) {
        return NextResponse.json(signInRefusal(err, 'startOAuthFailed'), { status: 400 })
    }
}
