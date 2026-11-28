import 'server-only'

import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, serviceRegistryKey, type VaultConflict, type VaultItemSummary, type VaultSkill } from '@rerun/contracts'

import { AccessDeniedError, assertAgentAccess, isAdminActor, manageableSpaceIds, requireLightSessionActor, visibleSpaceIds, type Actor, type BoxAccess } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { EngineRequestError, supportsForemanCoworker, supportsVault, supportsVaultInstance, supportsVaultRename } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { attachVaultItem, deleteVaultItem, detachVaultItem, getVaultItem, getVaultItemUsage, instanceVaultItem, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { instanceRenames, nextServiceInstance } from '@/lib/services/instances'
import { revokeVaultComposioAccount } from '@/lib/vault/composio'
import { dropMigrationCopy } from '@/lib/vault/copies'
import { isRegistryItem, vaultRegistryKey } from '@/lib/vault/registry-view'
import { AppError } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine, NoEngineError } from './workspace-engine.service'
import { sitsInABox } from '@/lib/agents/in-box'

// The workspace's Vault, seen from the hub: who may do what (plan, section 4.5) and the box's ids of
// coworkers turned into the hub's. Every value stays on the box; nothing here reads one.
//
// | Action                                    | Who                                   |
// | List (names, accounts, never a value)     | any member                            |
// | Add an entry, reconnect it                | `manage` on at least one Box          |
// | Attach or detach a coworker               | `manage` on that coworker's Box       |
// | Share with everyone, change, delete       | an admin, or whoever manages every    |
// |                                           | coworker it reaches (change only)     |
// | Rename an account                         | as change                             |

export class VaultUnavailableError extends AppError {
    constructor() {
        super('vaultUnavailable')
        this.name = 'VaultUnavailableError'
    }
}

// `*`: two entries shared with everyone clash; no coworker name: one the hub does not know.
function conflictMessage(conflicts: VaultConflict['conflicts'], coworker: string | null): { code: 'vaultConflict' | 'vaultConflictEveryone' | 'vaultConflictSomeone'; params: Record<string, string> } {
    const name = conflicts[0]?.name ?? ''
    if (conflicts[0]?.agentId === '*') return { code: 'vaultConflictEveryone', params: { name } }
    if (coworker === null) return { code: 'vaultConflictSomeone', params: { name } }
    return { code: 'vaultConflict', params: { name, coworker } }
}

export class VaultConflictError extends AppError {
    readonly conflicts: VaultConflict['conflicts']
    constructor(conflicts: VaultConflict['conflicts'], coworker: string | null) {
        const { code, params } = conflictMessage(conflicts, coworker)
        super(code, params)
        this.conflicts = conflicts
        this.name = 'VaultConflictError'
    }
}

// A coworker as the Vault shows it: the hub's id, the box's id the engine knows it by, and its Box.
export type VaultCoworker = { id: string; engineAgentId: string; name: string; spaceId: string }

export type VaultContext = { actor: Actor; conn: EngineConnection; coworkers: VaultCoworker[]; byEngineId: Map<string, VaultCoworker> }

// The foreman holds entries like a coworker, with no row and no Box: it is listed under its fixed
// id, in a Box that does not exist. Nobody manages that Box, so only an admin attaches to it.
const FOREMAN_VAULT_COWORKER: VaultCoworker = { id: FOREMAN_AGENT_ID, engineAgentId: FOREMAN_AGENT_ID, name: FOREMAN_DISPLAY_NAME, spaceId: '' }

export async function vaultContext(actor?: Actor): Promise<VaultContext> {
    const resolved = actor ?? (await requireLightSessionActor())
    const engine = await findWorkspaceEngine(resolved.workspaceId)
    if (!engine) throw new NoEngineError()
    if (!(await supportsVault(engine.conn))) throw new VaultUnavailableError()
    const [{ data }, withForeman] = await Promise.all([
        selectAll(createServiceRoleClient(), 'agents', ['id', 'engine_agent_id', 'name', 'space_id'] as const, { workspace_id: resolved.workspaceId, kind: 'coworker' }),
        supportsForemanCoworker(engine.conn),
    ])
    const coworkers = (data ?? []).filter(sitsInABox).flatMap(row => (row.engine_agent_id ? [{ id: row.id, engineAgentId: row.engine_agent_id, name: row.name, spaceId: row.space_id }] : []))
    if (withForeman) coworkers.unshift(FOREMAN_VAULT_COWORKER)
    return { actor: resolved, conn: engine.conn, coworkers, byEngineId: new Map(coworkers.map(c => [c.engineAgentId, c])) }
}

export function requireAdmin(actor: Actor): void {
    if (!isAdminActor(actor)) throw new AccessDeniedError('vaultAdminOnly')
}

export async function assertCanAdd(actor: Actor): Promise<void> {
    const spaces = await manageableSpaceIds(actor)
    if (spaces !== 'all' && spaces.size === 0) throw new AccessDeniedError('vaultManageOnly')
}

// A coworker is named by the hub's id (list_vault, the app) or by its engine id: the Chief of Staff's own
// tools (call_agent, its coworker databases) list it under that one.
export async function assertManagesCoworker(ctx: Pick<VaultContext, 'actor' | 'coworkers' | 'byEngineId'>, id: string): Promise<VaultCoworker> {
    const coworker = ctx.coworkers.find(c => c.id === id) ?? ctx.byEngineId.get(id)
    const notFound = new AuthorizationError('vaultCoworkerNotFound', { id })
    if (!coworker) throw notFound
    const spaces = await manageableSpaceIds(ctx.actor)
    if (spaces !== 'all' && !spaces.has(coworker.spaceId)) {
        const visible = await visibleSpaceIds(ctx.actor)
        if (visible === 'all' || visible.has(coworker.spaceId)) throw new AccessDeniedError()
        throw notFound
    }
    return coworker
}

// Changing what an item is touches every coworker it reaches: an admin may, and so may someone who
// manages each of them. Nobody but an admin changes an item shared with everyone. The engine's own
// calls only ever change an item that one coworker, the caller, holds.
// An entry no coworker holds yet is anyone's who may add to the Vault.
export async function canChangeItem(actor: Actor, item: VaultItemSummary, ctx: Pick<VaultContext, 'byEngineId'>, callerEngineAgentId?: string, manageable?: 'all' | Set<string>): Promise<boolean> {
    if (actor.kind === 'workspace') return !item.sharedWithAll && item.agentIds.length > 0 && item.agentIds.every(id => id === callerEngineAgentId)
    if (isAdminActor(actor)) return true
    if (item.sharedWithAll) return false
    const spaces = manageable ?? (await manageableSpaceIds(actor))
    if (spaces === 'all') return true
    if (item.agentIds.length === 0) return spaces.size > 0
    return item.agentIds.every(id => {
        const coworker = ctx.byEngineId.get(id)
        return coworker !== undefined && spaces.has(coworker.spaceId)
    })
}

export async function assertCanChangeItem(actor: Actor, item: VaultItemSummary, ctx: Pick<VaultContext, 'byEngineId'>, callerEngineAgentId?: string): Promise<void> {
    if (!(await canChangeItem(actor, item, ctx, callerEngineAgentId))) throw new AccessDeniedError(actor.kind === 'workspace' ? 'vaultSharedItem' : 'vaultAdminOnly')
}

// The engine answers a refused attachment with the coworker and the item it clashes with.
export function conflictOf(err: unknown, ctx: Pick<VaultContext, 'byEngineId'>): VaultConflictError | null {
    if (!(err instanceof EngineRequestError) || err.status !== 409) return null
    const body = err.message.slice(err.message.indexOf('{'))
    try {
        const parsed = JSON.parse(body) as VaultConflict
        const first = parsed.conflicts?.[0]
        if (!first) return null
        return new VaultConflictError(parsed.conflicts, ctx.byEngineId.get(first.agentId)?.name ?? null)
    } catch {
        return null
    }
}

export async function rethrowConflict<T>(ctx: Pick<VaultContext, 'byEngineId'>, write: () => Promise<T>): Promise<T> {
    try {
        return await write()
    } catch (err) {
        throw conflictOf(err, ctx) ?? err
    }
}

export async function readItem(ctx: VaultContext, id: string): Promise<VaultItemSummary> {
    try {
        return await getVaultItem(ctx.conn, id)
    } catch (err) {
        if (err instanceof EngineRequestError && err.status === 404) throw new AuthorizationError('vaultItemNotFound')
        throw err
    }
}

export type VaultEntryView = VaultItemSummary & {
    // The attached coworkers the caller can see; the others are only counted.
    coworkers: VaultCoworker[]
    hiddenCoworkers: number
    canChange: boolean
}

export type VaultListing = {
    entries: VaultEntryView[]
    // Every coworker the caller can see, and which of them it may attach things to.
    coworkers: Array<VaultCoworker & { canManage: boolean }>
    canAdd: boolean
    isAdmin: boolean
    // The box keeps the name given to an account; an older one would drop it.
    canRename: boolean
}

// The box names an app it moved into the Vault on its own by its slug: it has no catalog to read.
async function withCatalogNames(items: VaultItemSummary[]): Promise<VaultItemSummary[]> {
    const bare = (item: VaultItemSummary) => item.kind === 'service' && !!item.slug && item.name === item.slug
    const slugs = [...new Set(items.filter(bare).map(item => item.slug as string))]
    if (slugs.length === 0) return items
    const { data } = await selectAll(createServiceRoleClient(), 'services', ['slug', 'name'] as const, { slug: slugs })
    const names = new Map((data ?? []).map(row => [row.slug, row.name]))
    return items.map(item => (bare(item) && names.get(item.slug as string) ? { ...item, name: names.get(item.slug as string) as string } : item))
}

export async function listVault(actor?: Actor): Promise<VaultListing> {
    const ctx = await vaultContext(actor)
    const [items, visible, manageable, canRename] = await Promise.all([listVaultItems(ctx.conn).then(withCatalogNames), visibleSpaceIds(ctx.actor), manageableSpaceIds(ctx.actor), supportsVaultRename(ctx.conn)])
    const sees = (c: VaultCoworker) => visible === 'all' || visible.has(c.spaceId)
    const manages = (c: VaultCoworker) => manageable === 'all' || manageable.has(c.spaceId)
    const entries = await Promise.all(
        items.map(async item => {
            const attached = item.agentIds.flatMap(id => ctx.byEngineId.get(id) ?? [])
            const seen = attached.filter(sees)
            return { ...item, coworkers: seen, hiddenCoworkers: attached.length - seen.length, canChange: await canChangeItem(ctx.actor, item, ctx, undefined, manageable) }
        }),
    )
    return {
        entries,
        coworkers: ctx.coworkers.filter(sees).map(c => ({ ...c, canManage: manages(c) })),
        canAdd: manageable === 'all' || manageable.size > 0,
        isAdmin: isAdminActor(ctx.actor),
        canRename,
    }
}

export async function attachVaultEntry(itemId: string, agentId: string, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const coworker = await assertManagesCoworker(ctx, agentId)
    const item = await readItem(ctx, itemId)
    try {
        return await lendVaultEntry(ctx, item, coworker.engineAgentId)
    } catch (err) {
        const renamed = err instanceof VaultConflictError ? await withOwnInstance(ctx, item, err.conflicts) : null
        if (!renamed) throw err
        return lendVaultEntry(ctx, renamed, coworker.engineAgentId)
    }
}

async function lendVaultEntry(ctx: VaultContext, item: VaultItemSummary, engineAgentId: string): Promise<VaultItemSummary> {
    const twins = isRegistryItem(item) && item.status === 'active' ? await detachPendingTwins(ctx, item, engineAgentId) : []
    try {
        const attached = await rethrowConflict(ctx, () => attachVaultItem(ctx.conn, item.id, engineAgentId))
        for (const twin of twins) if (twin.agentIds.length === 0 && neverSignedIn(twin)) await deleteVaultItem(ctx.conn, twin.id)
        return attached
    } catch (err) {
        for (const twin of twins) await attachVaultItem(ctx.conn, twin.id, engineAgentId).catch(undo => console.warn(`[vault] entry ${twin.id} left off ${engineAgentId}:`, undo instanceof Error ? undo.message : undo))
        throw err
    }
}

// An account added before its app took several accounts holds the app's bare names, and clashes with
// the account of the app the coworker already has. It moves to an instance of its own, under the names
// a second account is compiled with today. The coworkers holding it keep it under those names, and the
// copy a migration left in their folder under the old key goes, as on a detach, or it would come back.
// Null when the clash is anything else: another app, a paid app, or a box that cannot rename. Null
// too for a caller who may attach but not change the account: the rename reaches every coworker
// holding it. The box's own key renames as it shares and deletes, as an admin.
async function withOwnInstance(ctx: VaultContext, item: VaultItemSummary, conflicts: VaultConflict['conflicts']): Promise<VaultItemSummary | null> {
    if (!isRegistryItem(item) || item.app) return null
    if (!isAdminActor(ctx.actor) && !(await canChangeItem(ctx.actor, item, ctx))) return null
    const renamed = item.instanceId ? await finishInstance(ctx, item, item.instanceId) : await startInstance(ctx, item, conflicts)
    if (!renamed) return null
    const bareKey = serviceRegistryKey(item.slug)
    const holders = await getVaultItemUsage(ctx.conn, item.id).catch(() => renamed.agentIds)
    for (const holder of holders) await dropMigrationCopy(ctx.conn, holder, bareKey, item).catch(err => console.warn(`[vault] copy of ${holder} left in place:`, err instanceof Error ? err.message : err))
    return renamed
}

// A rename the box was stopped in once the account had its instance: its old variables are still
// beside the new ones and keep clashing, and only a call with the same instance takes them away.
async function finishInstance(ctx: VaultContext, item: VaultItemSummary & { slug: string }, instanceId: string): Promise<VaultItemSummary | null> {
    const renames = instanceRenames(item.slug, item.tokens, item.envKeys, instanceId)
    const ownServers = new Set(item.mcpServers.map(server => server.name))
    const env = Object.fromEntries(Object.entries(renames.env).filter(([, to]) => item.envKeys.includes(to)))
    const servers = Object.fromEntries(Object.entries(renames.servers).filter(([, to]) => ownServers.has(to)))
    if (Object.keys(env).length === 0 || !(await supportsVaultInstance(ctx.conn))) return null
    return rethrowConflict(ctx, () => instanceVaultItem(ctx.conn, item.id, { instanceId, servers, env }))
}

async function startInstance(ctx: VaultContext, item: VaultItemSummary & { slug: string }, conflicts: VaultConflict['conflicts']): Promise<VaultItemSummary | null> {
    const key = vaultRegistryKey(item)
    const vault = await listVaultItems(ctx.conn)
    const sameAccountNames = (itemId: string) => vault.some(other => other.id === itemId && isRegistryItem(other) && vaultRegistryKey(other) === key)
    if (!conflicts.every(conflict => conflict.kind !== 'skill' && sameAccountNames(conflict.itemId))) return null
    const { loadManifest } = await import('./services.service')
    const manifest = await loadManifest(item.slug)
    const instance = manifest && nextServiceInstance(manifest, vault.filter(other => other.slug === item.slug))
    if (!instance || !(await supportsVaultInstance(ctx.conn))) return null

    const { instanceId, label } = instance
    const renames = instanceRenames(item.slug, item.mcpServers.map(server => server.name), item.envKeys, instanceId)
    // Before the rename, so that one stopped half way clashes again and is made from the start.
    const skills = await accountSkills({ ...item, instanceId, label: item.label ?? label })
    if (skills) await patchVaultItem(ctx.conn, item.id, { skills })
    try {
        return await rethrowConflict(ctx, () => instanceVaultItem(ctx.conn, item.id, { instanceId, ...(item.label ? {} : { label }), ...renames }))
    } catch (err) {
        if (skills) await patchVaultItem(ctx.conn, item.id, { skills: item.skills }).catch(undo => console.warn(`[vault] skills of ${item.id} left renamed:`, undo instanceof Error ? undo.message : undo))
        throw err
    }
}

// The coworker's own install of the app still waiting on its sign-in sits on the same registry key as
// the account about to be lent: it holds the same server, which the engine refuses next to it, and
// would win over it when the registry is read. It is taken off the coworker before the account goes on,
// the way a detach does, so the migration copy dropped with it cannot take the lent account along.
async function detachPendingTwins(ctx: VaultContext, lent: VaultItemSummary & { slug: string }, engineAgentId: string): Promise<VaultItemSummary[]> {
    const key = vaultRegistryKey(lent)
    const twins = (await listVaultItems(ctx.conn, engineAgentId)).filter(other => other.id !== lent.id && other.status !== 'active' && !other.sharedWithAll && isRegistryItem(other) && vaultRegistryKey(other) === key)
    const detached: VaultItemSummary[] = []
    for (const twin of twins) {
        detached.push(await detachVaultItem(ctx.conn, twin.id, engineAgentId))
        await dropMigrationCopy(ctx.conn, engineAgentId, key, twin)
    }
    return detached
}

// Deleting an entry is an admin's call: the lend only clears away an install nobody ever signed in to.
function neverSignedIn(item: VaultItemSummary): boolean {
    return item.tokens.length === 0 && !item.composio?.connectedAccountId && !item.managed?.accountEmail && !item.customLabel
}

export async function detachVaultEntry(itemId: string, agentId: string, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const coworker = await assertManagesCoworker(ctx, agentId)
    const item = await readItem(ctx, itemId)
    const detached = await detachVaultItem(ctx.conn, itemId, coworker.engineAgentId)
    if (isRegistryItem(item) && !detached.sharedWithAll) await dropMigrationCopy(ctx.conn, coworker.engineAgentId, vaultRegistryKey(item), item)
    return detached
}

export async function shareVaultEntry(itemId: string, sharedWithAll: boolean, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    requireAdmin(ctx.actor)
    const item = await readItem(ctx, itemId)
    if (sharedWithAll && item.app) throw new AccessDeniedError('vaultPaidAppEveryone')
    return rethrowConflict(ctx, () => patchVaultItem(ctx.conn, itemId, { sharedWithAll }))
}

// The name a person gives an account, kept apart from the label its sign-ins write. An empty name
// gives the account back the one its connection reported.
export async function renameVaultEntry(itemId: string, name: string | null, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const item = await readItem(ctx, itemId)
    await assertCanChangeItem(ctx.actor, item, ctx)
    if (item.kind !== 'service') throw new Error('Only the account of an app is renamed')
    if (!(await supportsVaultRename(ctx.conn))) throw new AppError('vaultRenameUnsupported')
    const customLabel = name?.trim() || null
    const skills = await accountSkills({ ...item, customLabel: customLabel ?? undefined })
    return patchVaultItem(ctx.conn, itemId, { customLabel, ...(skills ? { skills } : {}) })
}

// Loaded here rather than at the top: services.service imports this module.
async function accountSkills(item: VaultItemSummary): Promise<VaultSkill[] | null> {
    const [{ loadManifest }, { accountSkillsOf }] = await Promise.all([import('./services.service'), import('@/lib/vault/install')])
    const manifest = item.slug ? await loadManifest(item.slug) : null
    return manifest && accountSkillsOf(manifest, item)
}

// The coworkers that lose the entry if it goes, those the caller sees by name and the others counted.
export async function vaultEntryUsage(itemId: string, actor?: Actor): Promise<{ coworkers: VaultCoworker[]; hidden: number }> {
    const ctx = await vaultContext(actor)
    await readItem(ctx, itemId)
    const visible = await visibleSpaceIds(ctx.actor)
    const usage = (await getVaultItemUsage(ctx.conn, itemId)).flatMap(id => ctx.byEngineId.get(id) ?? [])
    const seen = usage.filter(c => visible === 'all' || visible.has(c.spaceId))
    return { coworkers: seen, hidden: usage.length - seen.length }
}

export async function deleteVaultEntry(itemId: string, actor?: Actor): Promise<{ detached: VaultCoworker[] }> {
    const ctx = await vaultContext(actor)
    requireAdmin(ctx.actor)
    const item = await readItem(ctx, itemId)
    const { detached } = await deleteVaultItem(ctx.conn, itemId)
    await revokeVaultComposioAccount(ctx.actor.workspaceId, item).catch(err => console.warn(`[vault] Composio account of entry ${itemId} left connected:`, err instanceof Error ? err.message : err))
    if (isRegistryItem(item)) for (const engineAgentId of detached) await dropMigrationCopy(ctx.conn, engineAgentId, vaultRegistryKey(item), item).catch(err => console.warn(`[vault] copy of ${engineAgentId} left in place:`, err instanceof Error ? err.message : err))
    return { detached: detached.flatMap(id => ctx.byEngineId.get(id) ?? []) }
}

// After a sign-in made from the Vault itself, which writes the token straight to the entry.
export async function markVaultEntryAuthorized(itemId: string, actor?: Actor, account?: { label?: string }): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    const item = await readItem(ctx, itemId)
    // A sign-in that never wrote its token has nothing to flip: the entry stays signed out.
    if (item.oauth && !item.tokens.includes(item.oauth.serverName)) return item
    // A managed or Composio sign-in is recorded by what checked it, the callback or the claim.
    if (item.managed || item.composio) return item
    return patchVaultItem(ctx.conn, itemId, { status: 'active', ...(account?.label ? { label: account.label } : {}) })
}

// How many entries wait on a sign-in, for the dot on the workspace menu. Nothing to say, rather
// than an error, for a box without a Vault or one that cannot be reached.
export async function vaultSignedOutCount(actor?: Actor): Promise<number> {
    try {
        const resolved = actor ?? (await requireLightSessionActor())
        const engine = await findWorkspaceEngine(resolved.workspaceId)
        if (!engine || !(await supportsVault(engine.conn))) return 0
        return (await listVaultItems(engine.conn)).filter(item => item.status === 'needs_auth').length
    } catch {
        return 0
    }
}

// The Vault as one coworker's Apps tab shows it: the custom servers and secrets attached to it (its
// catalog apps already come through its registry), and the entries it could be attached to.
export type CoworkerVault = {
    attached: VaultItemSummary[]
    available: VaultItemSummary[]
    canAttach: boolean
}

export async function coworkerVault(agentId: string, actor?: Actor): Promise<CoworkerVault | null> {
    const resolved = actor ?? (await requireLightSessionActor())
    const { engineAgentId, access } = await vaultHolder(agentId, resolved)
    const engine = await findWorkspaceEngine(resolved.workspaceId)
    if (!engine || !engineAgentId || !(await supportsVault(engine.conn))) return null
    const items = await withCatalogNames(await listVaultItems(engine.conn))
    const holds = (item: VaultItemSummary) => item.sharedWithAll || item.agentIds.includes(engineAgentId)
    return {
        attached: items.filter(item => holds(item) && item.kind !== 'service'),
        available: items.filter(item => !holds(item)),
        canAttach: access === 'manage',
    }
}

async function vaultHolder(agentId: string, actor: Actor): Promise<{ engineAgentId: string | null; access: BoxAccess }> {
    const { agent, access } = await assertAgentAccess(agentId, 'use', actor)
    return { engineAgentId: agent.engine_agent_id, access }
}
