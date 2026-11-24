import 'server-only'

import type { VaultItemSummary } from '@rerun/contracts'

import { requireWorkspaceActor } from '@/app/api/_auth/access'
import { composioConfigured, deleteConnectedAccount, initiateConnectedAccount } from '@/lib/composio/client'
import { assertConnectedAccount } from '@/lib/composio/connected-account'
import { COMPOSIO_COOKIE_PATH, COMPOSIO_COOKIE_PREFIX, type ComposioOAuthContext, composioCallbackUrl, createComposioState, encodeComposioContext } from '@/lib/composio/oauth'
import { getVaultItem, patchVaultItem, putVaultToken } from '@/lib/engine/vault-client'
import { AppError } from '@/lib/i18n/action-error'
import { MANAGED_COOKIE_PATH, MANAGED_COOKIE_PREFIX, type ManagedOAuthContext, type ManagedToken, buildManagedAuthorizeUrl, createPkceState, encodeManagedContext, managedCallbackUrl, managedTokenBundle } from '@/lib/managed/oauth'
import { getManagedProvider } from '@/lib/managed/registry'
import type { ContextCookie } from '@/lib/oauth/context-cookie'
import type { AbandonedVaultAccount } from '@/lib/oauth/pending-grant'
import type { ManagedOAuthConfig } from '@/lib/managed/types'
import { composioVaultUserId, revokeVaultComposioAccount } from '@/lib/vault/composio'
import { loadManifest } from './services.service'
import { assertCanAdd, readItem, vaultContext, type VaultContext } from './vault.service'
import { findWorkspaceEngine } from './workspace-engine.service'

// The Composio and managed sign-ins of a Vault entry, which no coworker may hold yet. What an entry
// signs in to is read off the entry and the catalog, never off the caller.

export type VaultSignInStart = { url: string; cookie: ContextCookie }

async function vaultComposioApp(item: VaultItemSummary): Promise<{ name: string; toolkit: string; authConfigId: string; serverName: string }> {
    const manifest = item.slug && item.composio ? await loadManifest(item.slug) : null
    const target = manifest?.authMethods.find(method => method.kind === 'composio' && method.composio)?.composio
    if (!manifest || !target || !item.composio || target.toolkit !== item.composio.toolkit) throw new AppError('noProviderConnectionToSetUp', { key: item.name, provider: 'Composio' })
    return { name: manifest.name, toolkit: target.toolkit, authConfigId: target.authConfigId, serverName: item.composio.serverName }
}

// A self-hosted install ships the catalog without Rerun Cloud's auth configs: each one is created in
// Composio and its id written on the service before the app can connect.
function assertComposioConfigured({ name, toolkit, authConfigId }: { name: string; toolkit: string; authConfigId: string }): void {
    if (!composioConfigured()) throw new AppError('composioNotConfigured')
    if (!authConfigId) throw new AppError('composioAuthConfigMissing', { name, toolkit })
}

function configuredProvider(providerId: string): { oauth: ManagedOAuthConfig; clientId: string } {
    const provider = getManagedProvider(providerId)
    if (!provider) throw new AppError('unknownOAuthProvider', { provider: providerId })
    const clientId = process.env[provider.oauth.clientIdEnv]
    if (!clientId) throw new AppError('providerNotConfigured', { provider: provider.label })
    return { oauth: provider.oauth, clientId }
}

export async function beginVaultComposio(req: Request, workspaceId: number, item: VaultItemSummary, mobileGrant?: string): Promise<VaultSignInStart> {
    const app = await vaultComposioApp(item)
    assertComposioConfigured(app)
    const state = createComposioState()
    const userId = await composioVaultUserId(workspaceId, item)
    const { connectedAccountId, redirectUrl } = await initiateConnectedAccount(userId, app.authConfigId, composioCallbackUrl(req, state))
    const ctx: ComposioOAuthContext = { agentId: '', key: item.id, toolkit: app.toolkit, serverName: app.serverName, connectedAccountId, vault: { itemId: item.id, workspaceId }, ...(mobileGrant ? { mobileGrant } : {}) }
    return { url: redirectUrl, cookie: { name: COMPOSIO_COOKIE_PREFIX + state, value: encodeComposioContext(ctx), path: COMPOSIO_COOKIE_PATH } }
}

export async function beginVaultManaged(req: Request, workspaceId: number, item: VaultItemSummary, mobileGrant?: string): Promise<VaultSignInStart> {
    if (!item.managed) throw new AppError('vaultEntryOtherServer')
    const { provider: providerId, serverName } = item.managed
    const { oauth, clientId } = configuredProvider(providerId)
    const { verifier, challenge, state } = createPkceState()
    const ctx: ManagedOAuthContext = { verifier, agentId: '', key: item.id, provider: providerId, serverName, redirectUri: managedCallbackUrl(req, providerId), vault: { itemId: item.id, workspaceId }, ...(mobileGrant ? { mobileGrant } : {}) }
    return { url: buildManagedAuthorizeUrl(oauth, clientId, ctx, challenge, state), cookie: { name: MANAGED_COOKIE_PREFIX + state, value: encodeManagedContext(ctx), path: MANAGED_COOKIE_PATH } }
}

// The member whose browser the web callback runs in, in the workspace the sign-in started in and
// still allowed to add to its Vault.
export async function vaultSignInContext(workspaceId: number): Promise<VaultContext> {
    const ctx = await vaultContext(await requireWorkspaceActor(workspaceId))
    await assertCanAdd(ctx.actor)
    return ctx
}

export async function assertVaultComposioAccount(ctx: VaultContext, itemId: string, connectedAccountId: string): Promise<VaultItemSummary> {
    const item = await readItem(ctx, itemId)
    const { authConfigId } = await vaultComposioApp(item)
    await assertConnectedAccount(connectedAccountId, { userId: await composioVaultUserId(ctx.actor.workspaceId, item), authConfigId })
    return item
}

// The account it had goes once the new one is in: a tool call names the Composio user alone, and two
// accounts of one user would leave Composio to pick.
export async function connectVaultComposio(ctx: VaultContext, itemId: string, connectedAccountId: string): Promise<void> {
    const item = await assertVaultComposioAccount(ctx, itemId, connectedAccountId)
    if (!item.composio) return
    const { toolkit, serverName, userId, connectedAccountId: previous } = item.composio
    await patchVaultItem(ctx.conn, item.id, { status: 'active', composio: { toolkit, serverName, connectedAccountId, ...(userId ? { userId } : {}) } })
    if (!previous || previous === connectedAccountId) return
    await revokeVaultComposioAccount(ctx.actor.workspaceId, item).catch(err => console.warn(`[vault] former Composio account of entry ${item.id} left connected:`, err instanceof Error ? err.message : err))
}

// The account a sign-in made and could not record: left there, Composio could pick it over the one the
// entry names. Its id is the hub's own, sealed or parked, never the box's. An entry that names it keeps
// it (a replayed callback), and one that cannot be read does not: it was never recorded, or the next
// tool call finds the entry signed out.
export async function discardVaultComposioAccount({ workspaceId, itemId, connectedAccountId }: AbandonedVaultAccount): Promise<void> {
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        const item = engine && (await getVaultItem(engine.conn, itemId).catch(() => null))
        if (item?.composio?.connectedAccountId === connectedAccountId) return
        await deleteConnectedAccount(connectedAccountId)
    } catch (err) {
        console.warn(`[vault] unfinished Composio account of entry ${itemId} left connected:`, err instanceof Error ? err.message : err)
    }
}

export async function connectVaultManaged(ctx: VaultContext, itemId: string, providerId: string, token: ManagedToken, email?: string): Promise<void> {
    const item = await readItem(ctx, itemId)
    const provider = getManagedProvider(providerId)
    if (!provider || item.managed?.provider !== providerId) throw new AppError('providerMismatch')
    const { serverName } = item.managed
    await putVaultToken(ctx.conn, item.id, serverName, managedTokenBundle(provider, token))
    await patchVaultItem(ctx.conn, item.id, { status: 'active', managed: { provider: providerId, serverName, ...(email ? { accountEmail: email } : {}) }, ...(email ? { label: email } : {}) })
}
