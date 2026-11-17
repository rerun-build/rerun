import 'server-only'

import type { Actor } from '@/app/api/_auth/access'
import { requireConfirmation, requireString } from '@/lib/mcp/args'
import { dispatchShareTool } from './mcp-shares.service'
import { attachVaultPaidAccount, detachVaultPaidAccount, vaultPaidAccounts, type VaultPaidAccount } from './vault-apps.service'
import { attachVaultEntry, deleteVaultEntry, detachVaultEntry, listVault, shareVaultEntry, VaultConflictError, VaultUnavailableError, type VaultCoworker, type VaultEntryView, type VaultListing } from './vault.service'
import { NoEngineError } from './workspace-engine.service'

const UNAVAILABLE = {
    available: false,
    message: "This workspace's machine keeps no Vault yet: every app is connected coworker by coworker. Use list_agent_connectors and attach_connector.",
} as const

const coworkerView = (coworker: Pick<VaultCoworker, 'id' | 'name'>) => ({ id: coworker.id, name: coworker.name })

// What the caller reads of an entry: enough to name it, tell whether it works and who holds it.
// Variable names, token servers, settings, Composio ids and who added it stay out.
function entryView(entry: VaultEntryView, isAdmin: boolean) {
    return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        ...(entry.slug ? { slug: entry.slug } : {}),
        ...(entry.label ? { account: entry.label } : {}),
        status: entry.status,
        sharedWithAll: entry.sharedWithAll,
        coworkers: entry.coworkers.map(coworkerView),
        ...(entry.hiddenCoworkers > 0 ? { hiddenCoworkers: entry.hiddenCoworkers } : {}),
        // The Vault keeps its workspace rule for the box's own calls: a key acting as the workspace is an admin.
        canChange: isAdmin || entry.canChange,
    }
}

function paidAccountView(account: VaultPaidAccount, names: Map<string, string>) {
    return {
        id: account.connectionId,
        slug: account.slug,
        name: account.name,
        ...(account.label ? { account: account.label } : {}),
        status: account.status,
        coworkers: account.agentIds.flatMap(id => (names.has(id) ? [{ id, name: names.get(id) as string }] : [])),
        ...(account.hiddenAgents > 0 ? { hiddenCoworkers: account.hiddenAgents } : {}),
    }
}

function listingView(listing: VaultListing, paid: VaultPaidAccount[]) {
    const names = new Map(listing.coworkers.map(coworker => [coworker.id, coworker.name]))
    return {
        available: true as const,
        entries: listing.entries.map(entry => entryView(entry, listing.isAdmin)),
        paidAccounts: paid.map(account => paidAccountView(account, names)),
        coworkers: listing.coworkers.map(coworker => ({ ...coworkerView(coworker), canManage: coworker.canManage })),
        canAdd: listing.canAdd,
        isAdmin: listing.isAdmin,
    }
}

async function readVault(actor: Actor) {
    try {
        const [listing, paid] = await Promise.all([listVault(actor), vaultPaidAccounts(actor)])
        return listingView(listing, paid)
    } catch (err) {
        if (err instanceof VaultUnavailableError || err instanceof NoEngineError) return UNAVAILABLE
        throw err
    }
}

// An id from list_vault names either an entry of the box's Vault or a paid account, kept in Supabase.
async function paidAccount(actor: Actor, entryId: string): Promise<VaultPaidAccount | undefined> {
    return (await vaultPaidAccounts(actor)).find(account => account.connectionId === entryId)
}

// The Vault names the variable or the server that clashes, which list_vault never shows: the caller
// needs the entry that already hands it out.
async function namingTheClash<T>(actor: Actor, write: () => Promise<T>): Promise<T> {
    try {
        return await write()
    } catch (err) {
        if (!(err instanceof VaultConflictError)) throw err
        const heldId = err.conflicts[0]?.itemId
        const listing = heldId ? await listVault(actor).catch(() => null) : null
        const held = listing?.entries.find(entry => entry.id === heldId)
        if (!held) throw err
        throw new Error(`${err.message}: "${held.name}" (entryId ${held.id}).`)
    }
}

// The entry once changed, as list_vault shows it.
async function entryAfter(actor: Actor, entryId: string) {
    const vault = await readVault(actor)
    if (!vault.available) return vault
    return vault.entries.find(entry => entry.id === entryId) ?? vault.paidAccounts.find(account => account.id === entryId) ?? null
}

async function attachEntry(actor: Actor, args: Record<string, unknown>) {
    const entryId = requireString(args.entryId, 'entryId')
    const agentId = requireString(args.agentId, 'agentId')
    const paid = await paidAccount(actor, entryId)
    if (paid) await attachVaultPaidAccount(paid.slug, paid.connectionId, agentId, actor)
    else await namingTheClash(actor, () => attachVaultEntry(entryId, agentId, actor))
    return entryAfter(actor, entryId)
}

async function detachEntry(actor: Actor, args: Record<string, unknown>) {
    const entryId = requireString(args.entryId, 'entryId')
    const agentId = requireString(args.agentId, 'agentId')
    const paid = await paidAccount(actor, entryId)
    if (paid) {
        await detachVaultPaidAccount(paid.slug, paid.connectionId, agentId, actor)
        return entryAfter(actor, entryId)
    }
    // The box would take the coworker off the selection and still hand it the entry.
    const entry = (await listVault(actor)).entries.find(candidate => candidate.id === entryId)
    if (entry?.sharedWithAll) throw new Error('Every coworker gets this entry. Switch sharedWithAll off with share_vault_entry first, then take it back from this coworker.')
    await detachVaultEntry(entryId, agentId, actor)
    return entryAfter(actor, entryId)
}

async function shareEntry(actor: Actor, args: Record<string, unknown>) {
    const entryId = requireString(args.entryId, 'entryId')
    if (typeof args.sharedWithAll !== 'boolean') throw new Error('sharedWithAll must be true or false.')
    if (await paidAccount(actor, entryId)) throw new Error('A paid app account is lent coworker by coworker: use attach_vault_entry.')
    const sharedWithAll = args.sharedWithAll
    await namingTheClash(actor, () => shareVaultEntry(entryId, sharedWithAll, actor))
    return entryAfter(actor, entryId)
}

async function deleteEntry(actor: Actor, args: Record<string, unknown>) {
    const entryId = requireString(args.entryId, 'entryId')
    if (await paidAccount(actor, entryId)) throw new Error('A paid app account has its own subscription: take it back from its coworkers with detach_vault_entry, and end it in the Rerun app.')
    requireConfirmation(args, 'this Vault entry and its credentials')
    const { detached } = await deleteVaultEntry(entryId, actor)
    return { deleted: true, detached: detached.map(coworkerView) }
}

// Chained after the account tools and before sharing, whose own default hands over to the template tools.
export async function dispatchVaultTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'list_vault':
            return readVault(actor)
        case 'attach_vault_entry':
            return attachEntry(actor, args)
        case 'detach_vault_entry':
            return detachEntry(actor, args)
        case 'share_vault_entry':
            return shareEntry(actor, args)
        case 'delete_vault_entry':
            return deleteEntry(actor, args)
        default:
            return await dispatchShareTool(actor, name, args)
    }
}
