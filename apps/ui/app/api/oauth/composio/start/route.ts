import { parseServiceRegistryKey } from '@rerun/contracts'
import { assertAgentAccess } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { loadManifest } from '@/app/api/_services/services.service'
import { composioConfigured, initiateConnectedAccount } from '@/lib/composio/client'
import { composioUserForKey } from '@/lib/vault/composio'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, composioCallbackUrl, createComposioState, encodeComposioContext } from '@/lib/composio/oauth'
import { readRegistry, resolveRegistryEntry } from '@/lib/services/registry'
import { describeSignInError } from '@/lib/net/network-error'
import { NextResponse } from 'next/server'

// Begin a Composio connect flow: ask Composio for a hosted sign-in link scoped to a
// server-derived per-agent (and per-instance) user_id, and stash the install context in an httpOnly cookie keyed
// by state so /callback can finish it. The COMPOSIO_API_KEY never leaves this server.
export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { agentId: string; key?: string; slug?: string }
        const { agentId } = body
        const key = body.key ?? body.slug ?? ''
        const { actor } = await assertAgentAccess(agentId, 'manage')

        if (!composioConfigured()) return NextResponse.json({ error: 'Composio connections are not configured on this server.' }, { status: 400 })

        const { instanceId } = parseServiceRegistryKey(key)
        const manifest = await loadManifest(key)
        const method = manifest?.authMethods.find(m => m.kind === 'composio' && m.composio)
        // An extra account's server is `<template>-<instanceId>`, a name only its registry entry holds.
        const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
        const entry = resolveRegistryEntry(await readRegistry(conn, engineAgentId), key)?.entry
        const serverName = entry?.composio?.serverName ?? (instanceId ? undefined : method?.mcpServers[0]?.name)
        if (!manifest || !method?.composio || !serverName) {
            return NextResponse.json({ error: `${key} has no Composio connection to set up.` }, { status: 400 })
        }
        // A self-hosted install ships the catalog without Rerun Cloud's auth configs: each one is created in
        // Composio and its id written on the service before the app can connect.
        if (!method.composio.authConfigId) {
            return NextResponse.json({ error: `${manifest.name} needs a Composio auth config: create one for ${method.composio.toolkit} in Composio and set its id on the service.` }, { status: 400 })
        }

        const state = createComposioState()
        const userId = await composioUserForKey(conn, engineAgentId, agentId, key)
        const { connectedAccountId, redirectUrl } = await initiateConnectedAccount(userId, method.composio.authConfigId, composioCallbackUrl(req, state))

        const ctx: ComposioOAuthContext = {
            agentId,
            key,
            toolkit: method.composio.toolkit,
            serverName,
            connectedAccountId,
        }

        const res = NextResponse.json({ authorizationUrl: redirectUrl })
        res.cookies.set(COMPOSIO_COOKIE_PREFIX + state, encodeComposioContext(ctx), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: COMPOSIO_COOKIE_PATH,
            maxAge: 600,
        })
        return res
    } catch (err) {
        return NextResponse.json({ error: describeSignInError(err, 'Failed to start the connection') }, { status: 400 })
    }
}
