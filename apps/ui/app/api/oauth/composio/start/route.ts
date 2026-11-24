import { parseServiceRegistryKey } from '@rerun/contracts'
import { assertAgentAccess } from '@/app/api/_auth/access'
import { assertCanAdd, readItem, vaultContext } from '@/app/api/_services/vault.service'
import { beginVaultComposio } from '@/app/api/_services/vault-sign-in.service'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { loadManifest } from '@/app/api/_services/services.service'
import { composioConfigured, initiateConnectedAccount } from '@/lib/composio/client'
import { setContextCookie } from '@/lib/oauth/context-cookie'
import { composioUserForKey } from '@/lib/vault/composio'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, composioCallbackUrl, createComposioState, encodeComposioContext } from '@/lib/composio/oauth'
import { readRegistry, resolveRegistryEntry } from '@/lib/services/registry'
import { signInRefusal } from '@/lib/net/network-error'
import { refusal } from '@/lib/i18n/action-error'
import { NextResponse } from 'next/server'

// Begin a Composio connect flow: ask Composio for a hosted sign-in link scoped to a
// server-derived per-agent (and per-instance) user_id, and stash the install context in an httpOnly cookie keyed
// by state so /callback can finish it. The COMPOSIO_API_KEY never leaves this server.
export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { agentId?: string; key?: string; slug?: string; vaultItemId?: string }
        if (body.vaultItemId) {
            const vault = await vaultContext()
            await assertCanAdd(vault.actor)
            const { url, cookie } = await beginVaultComposio(req, vault.actor.workspaceId, await readItem(vault, body.vaultItemId))
            return setContextCookie(NextResponse.json({ authorizationUrl: url }), cookie)
        }
        const agentId = body.agentId ?? ''
        const key = body.key ?? body.slug ?? ''
        const { actor } = await assertAgentAccess(agentId, 'manage')

        if (!composioConfigured()) return NextResponse.json(refusal('composioNotConfigured'), { status: 400 })

        const { instanceId } = parseServiceRegistryKey(key)
        const manifest = await loadManifest(key)
        const method = manifest?.authMethods.find(m => m.kind === 'composio' && m.composio)
        // An extra account's server is `<template>-<instanceId>`, a name only its registry entry holds.
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, 'manage', actor)
        const entry = resolveRegistryEntry(await readRegistry(conn, engineAgentId), key)?.entry
        const serverName = entry?.composio?.serverName ?? (instanceId ? undefined : method?.mcpServers[0]?.name)
        if (!manifest || !method?.composio || !serverName) {
            return NextResponse.json(refusal('noProviderConnectionToSetUp', { key, provider: 'Composio' }), { status: 400 })
        }
        // A self-hosted install ships the catalog without Rerun Cloud's auth configs: each one is created in
        // Composio and its id written on the service before the app can connect.
        if (!method.composio.authConfigId) {
            return NextResponse.json(refusal('composioAuthConfigMissing', { name: manifest.name, toolkit: method.composio.toolkit }), { status: 400 })
        }

        const state = createComposioState()
        const userId = await composioUserForKey(conn, actor.workspaceId, engineAgentId, agentId, key)
        const { connectedAccountId, redirectUrl } = await initiateConnectedAccount(userId, method.composio.authConfigId, composioCallbackUrl(req, state))

        const ctx: ComposioOAuthContext = {
            agentId,
            key,
            toolkit: method.composio.toolkit,
            serverName,
            connectedAccountId,
            workspaceId: actor.workspaceId,
        }

        return setContextCookie(NextResponse.json({ authorizationUrl: redirectUrl }), { name: COMPOSIO_COOKIE_PREFIX + state, value: encodeComposioContext(ctx), path: COMPOSIO_COOKIE_PATH })
    } catch (err) {
        return NextResponse.json(signInRefusal(err, 'startConnectionFailed'), { status: 400 })
    }
}
