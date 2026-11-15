import { assertAgentAccess } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import { readRegistry, resolveRegistryEntry } from '@/lib/services/registry'
import { describeSignInError } from '@/lib/net/network-error'
import { NextResponse } from 'next/server'

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
    try {
        const { provider: providerId } = await params
        const provider = getManagedProvider(providerId)
        if (!provider) return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 404 })

        const body = (await req.json()) as { agentId: string; key?: string; slug?: string; serverName?: string }
        const { agentId } = body
        const key = body.key ?? body.slug ?? ''
        const { actor } = await assertAgentAccess(agentId, 'manage')

        const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
        const entry = resolveRegistryEntry(await readRegistry(conn, engineAgentId), key)?.entry
        const serverName = entry?.managed?.serverName || body.serverName
        if (!serverName) return NextResponse.json({ error: `${key} has no ${provider.label} connection to set up.` }, { status: 400 })

        const clientId = process.env[provider.oauth.clientIdEnv]
        if (!clientId) return NextResponse.json({ error: `${provider.label} is not configured on this server.` }, { status: 400 })

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
        return NextResponse.json({ error: describeSignInError(err, 'Failed to start OAuth') }, { status: 400 })
    }
}
