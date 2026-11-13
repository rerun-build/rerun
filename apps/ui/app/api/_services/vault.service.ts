import 'server-only'

import type { UpdateVaultItemInput, VaultConflict, VaultItemSummary } from '@rerun/contracts'

import { AccessDeniedError, assertAgentAccess, isAdminActor, manageableSpaceIds, requireLightSessionActor, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { vaultFlag } from '@/flags'
import { EngineRequestError, supportsVault } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { attachVaultItem, deleteVaultItem, deleteVaultToken, detachVaultItem, getVaultItem, getVaultItemUsage, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { VAULT_RELEASED } from '@/lib/features'
import { AppError } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine, NoEngineError } from './workspace-engine.service'

// The workspace's Vault, seen from the hub: who may do what (plan, section 4.5) and the box's ids of
// coworkers turned into the hub's. Every value stays on the box; nothing here reads one.
//
// | Action                                    | Who                                   |
// | List (names, accounts, never a value)     | any member                            |
// | Add an entry, reconnect it                | `manage` on at least one Box          |
// | Attach or detach a coworker               | `manage` on that coworker's Box       |
// | Share with everyone, change, delete       | an admin, or whoever manages every    |
// |                                           | coworker it reaches (change only)     |

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

export async function vaultContext(actor?: Actor): Promise<VaultContext> {
    const resolved = actor ?? (await requireLightSessionActor())
    const engine = await findWorkspaceEngine(resolved.workspaceId)
    if (!engine) throw new NoEngineError()
    if (!(await supportsVault(engine.conn))) throw new VaultUnavailableError()
    const { data } = await selectAll(createServiceRoleClient(), 'agents', ['id', 'engine_agent_id', 'name', 'space_id'] as const, { workspace_id: resolved.workspaceId })
    const coworkers = (data ?? []).flatMap(row => (row.engine_agent_id ? [{ id: row.id, engineAgentId: row.engine_agent_id, name: row.name, spaceId: row.space_id }] : []))
    return { actor: resolved, conn: engine.conn, coworkers, byEngineId: new Map(coworkers.map(c => [c.engineAgentId, c])) }
}

// New connectors go to the Vault once the box keeps one and the feature is on for whoever installs.
// The engine's own calls (a coworker installing for itself) follow the release alone.
export async function vaultWritesEnabled(conn: EngineConnection, actor?: Actor): Promise<boolean> {
    if (!(await supportsVault(conn))) return false
    if (VAULT_RELEASED) return true
    if (actor?.kind === 'workspace') return false
    return vaultFlag().catch(() => false)
}

function requireAdmin(actor: Actor): void {
    if (!isAdminActor(actor)) throw new AccessDeniedError('vaultAdminOnly')
}

export async function assertCanAdd(actor: Actor): Promise<void> {
    const spaces = await manageableSpaceIds(actor)
    if (spaces !== 'all' && spaces.size === 0) throw new AccessDeniedError('vaultManageOnly')
}

export async function assertManagesCoworker(actor: Actor, coworker: VaultCoworker | undefined): Promise<VaultCoworker> {
    if (!coworker) throw new AuthorizationError('coworkerNotFound')
    const spaces = await manageableSpaceIds(actor)
    if (spaces !== 'all' && !spaces.has(coworker.spaceId)) {
        const visible = await visibleSpaceIds(actor)
        if (visible === 'all' || visible.has(coworker.spaceId)) throw new AccessDeniedError()
        throw new AuthorizationError('coworkerNotFound')
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

async function readItem(ctx: VaultContext, id: string): Promise<VaultItemSummary> {
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
}

export async function listVault(actor?: Actor): Promise<VaultListing> {
    const ctx = await vaultContext(actor)
    const [items, visible, manageable] = await Promise.all([listVaultItems(ctx.conn), visibleSpaceIds(ctx.actor), manageableSpaceIds(ctx.actor)])
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
    }
}

export async function attachVaultEntry(itemId: string, agentId: string, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const coworker = await assertManagesCoworker(ctx.actor, ctx.coworkers.find(c => c.id === agentId))
    await readItem(ctx, itemId)
    return rethrowConflict(ctx, () => attachVaultItem(ctx.conn, itemId, coworker.engineAgentId))
}

export async function detachVaultEntry(itemId: string, agentId: string, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const coworker = await assertManagesCoworker(ctx.actor, ctx.coworkers.find(c => c.id === agentId))
    await readItem(ctx, itemId)
    return detachVaultItem(ctx.conn, itemId, coworker.engineAgentId)
}

export async function shareVaultEntry(itemId: string, sharedWithAll: boolean, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    requireAdmin(ctx.actor)
    const item = await readItem(ctx, itemId)
    if (sharedWithAll && item.app) throw new AccessDeniedError('vaultPaidAppEveryone')
    return rethrowConflict(ctx, () => patchVaultItem(ctx.conn, itemId, { sharedWithAll }))
}

export async function renameVaultEntry(itemId: string, patch: Pick<UpdateVaultItemInput, 'name' | 'label'>, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    const item = await readItem(ctx, itemId)
    await assertCanChangeItem(ctx.actor, item, ctx)
    return patchVaultItem(ctx.conn, itemId, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) })
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
    await readItem(ctx, itemId)
    const { detached } = await deleteVaultItem(ctx.conn, itemId)
    return { detached: detached.flatMap(id => ctx.byEngineId.get(id) ?? []) }
}

// Sends an entry back to its sign-in: its tokens go, every coworker using it sees it to reconnect.
export async function signOutVaultEntry(itemId: string, actor?: Actor): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    const item = await readItem(ctx, itemId)
    for (const server of item.tokens) await deleteVaultToken(ctx.conn, itemId, server)
    return patchVaultItem(ctx.conn, itemId, { status: 'needs_auth' })
}

// After a sign-in made from the Vault itself, which writes the token straight to the entry.
export async function markVaultEntryAuthorized(itemId: string, actor?: Actor, account?: { label?: string }): Promise<VaultItemSummary> {
    const ctx = await vaultContext(actor)
    await assertCanAdd(ctx.actor)
    const item = await readItem(ctx, itemId)
    // A sign-in that never wrote its token has nothing to flip: the entry stays signed out.
    if (item.oauth && !item.tokens.includes(item.oauth.serverName)) return item
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
    const { agent, access } = await assertAgentAccess(agentId, 'use', resolved)
    const engine = await findWorkspaceEngine(resolved.workspaceId)
    if (!engine || !agent.engine_agent_id || !(await supportsVault(engine.conn))) return null
    const items = await listVaultItems(engine.conn)
    const holds = (item: VaultItemSummary) => item.sharedWithAll || item.agentIds.includes(agent.engine_agent_id as string)
    return {
        attached: items.filter(item => holds(item) && item.kind !== 'service'),
        available: items.filter(item => !holds(item)),
        canAttach: access === 'manage',
    }
}
