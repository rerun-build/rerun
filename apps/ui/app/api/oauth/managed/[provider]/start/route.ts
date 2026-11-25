import { assertAgentAccess, signedInUserId } from '@/app/api/_auth/access'
import { assertCanAdd, readItem, vaultContext } from '@/app/api/_services/vault.service'
import { beginVaultManaged } from '@/app/api/_services/vault-sign-in.service'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl } from '@/lib/managed/oauth'
import { setContextCookie } from '@/lib/oauth/context-cookie'
import { getManagedProvider } from '@/lib/managed/registry'
import { requestHostReturn, startOnRerunHost } from '@/lib/oauth/host-sign-in'
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

        const body = (await req.json()) as { agentId?: string; key?: string; slug?: string; serverName?: string; vaultItemId?: string }
        if (body.vaultItemId) {
            const vault = await vaultContext()
            await assertCanAdd(vault.actor)
            const item = await readItem(vault, body.vaultItemId)
            if (item.managed?.provider !== providerId) return NextResponse.json(refusal('vaultEntryOtherServer'), { status: 400 })
            const from = await requestHostReturn(req)
            if (from) return startOnRerunHost(from, { agentId: '', workspaceId: vault.actor.workspaceId, userId: signedInUserId(vault.actor) }, { flow: 'managed', provider: providerId, key: item.id, serverName: item.managed.serverName, vaultItem: item.id })
            const { url, cookie } = await beginVaultManaged(req, vault.actor.workspaceId, item)
            return setContextCookie(NextResponse.json({ authorizationUrl: url }), cookie)
        }
        const agentId = body.agentId ?? ''
        const key = body.key ?? body.slug ?? ''
        const { actor } = await assertAgentAccess(agentId, 'manage')

        // The token is stored under this name and the compiled server reads it back from there, so
        // the registry entry wins over whatever the page sent.
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'manage', actor)
        const entry = resolveRegistryEntry(await readRegistry(conn, engineAgentId), key)?.entry
        const serverName = entry?.managed?.serverName || body.serverName
        if (!serverName) return NextResponse.json(refusal('noProviderConnectionToSetUp', { key, provider: provider.label }), { status: 400 })

        const clientId = process.env[provider.oauth.clientIdEnv]
        if (!clientId) return NextResponse.json(refusal('providerNotConfigured', { provider: provider.label }), { status: 400 })

        const from = await requestHostReturn(req)
        if (from) return startOnRerunHost(from, { agentId, workspaceId: actor.workspaceId, userId: signedInUserId(actor) }, { flow: 'managed', provider: providerId, key, serverName })

        const { verifier, challenge, state } = createPkceState()
        const ctx: ManagedOAuthContext = {
            verifier,
            agentId,
            key,
            provider: providerId,
            serverName,
            redirectUri: managedCallbackUrl(req, providerId),
            workspaceId: actor.workspaceId,
        }

        return setContextCookie(NextResponse.json({ authorizationUrl: buildManagedAuthorizeUrl(provider.oauth, clientId, ctx, challenge, state) }), { name: MANAGED_COOKIE_PREFIX + state, value: encodeManagedContext(ctx), path: MANAGED_COOKIE_PATH })
    } catch (err) {
        return NextResponse.json(signInRefusal(err, 'startOAuthFailed'), { status: 400 })
    }
}
