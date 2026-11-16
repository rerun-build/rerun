import 'server-only'

import type { Actor } from '@/app/api/_auth/access'
import { attachVaultEntry, detachVaultEntry, listVault, VaultUnavailableError, type VaultEntryView, type VaultListing } from '@/app/api/_services/vault.service'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { requireString } from '@/lib/mcp/args'
import { FOREMAN_VAULT_TOOL_DEFS } from './tool-defs'

export const FOREMAN_VAULT_TOOL_NAMES: ReadonlySet<string> = new Set(FOREMAN_VAULT_TOOL_DEFS.map(def => def.name))

const UNAVAILABLE = {
    available: false,
    message: "This workspace's machine keeps no Vault yet: every app is connected coworker by coworker, from its Apps tab. Use list_agent_connectors and attach_connector.",
} as const

const PANEL_ONLY = 'Only an admin changes that, in the Vault panel (open_settings, vault).'

// What the model reads of an entry: enough to name it, tell whether it works and who holds it.
// Variable names, token servers, Composio ids and who added it stay out.
function entryView(entry: VaultEntryView) {
    return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        ...(entry.slug ? { slug: entry.slug } : {}),
        ...(entry.label ? { account: entry.label } : {}),
        status: entry.status,
        ...(entry.app ? { paid: true } : {}),
        sharedWithAll: entry.sharedWithAll,
        coworkers: entry.coworkers.map(coworker => ({ id: coworker.id, name: coworker.name })),
        ...(entry.hiddenCoworkers > 0 ? { hiddenCoworkers: entry.hiddenCoworkers } : {}),
    }
}

function vaultListingView(listing: VaultListing) {
    return {
        available: true,
        entries: listing.entries.map(entryView),
        // Sharing an entry with everyone and deleting one stay in the Vault panel, an admin's.
        youAreAdmin: listing.isAdmin,
    }
}

async function readVault(actor: Actor): Promise<VaultListing | null> {
    try {
        return await listVault(actor)
    } catch (err) {
        if (err instanceof VaultUnavailableError || err instanceof NoEngineError) return null
        throw err
    }
}

// A CLI model sometimes sends a boolean as its JSON text.
function requireBoolean(value: unknown, field: string): boolean {
    if (value === true || value === 'true') return true
    if (value === false || value === 'false') return false
    throw new Error(`${field} must be true or false.`)
}

function holds(entry: VaultEntryView, agentId: string): boolean {
    return entry.sharedWithAll || entry.coworkers.some(coworker => coworker.id === agentId)
}

async function setVaultLink(actor: Actor, args: Record<string, unknown>) {
    const itemId = requireString(args.itemId, 'itemId')
    const agentId = requireString(args.agentId, 'agentId')
    const attached = requireBoolean(args.attached, 'attached')
    const listing = await readVault(actor)
    if (!listing) return UNAVAILABLE

    const entry = listing.entries.find(candidate => candidate.id === itemId)
    if (!entry) throw new Error(`No entry of the Vault has the id "${itemId}". Take it from list_vault.`)
    const coworker = listing.coworkers.find(candidate => candidate.id === agentId)
    if (!coworker) throw new Error(`No coworker this user can see has the id "${agentId}". Take it from the board map.`)
    const account = entry.label ? `${entry.name} (${entry.label})` : entry.name
    const result = { itemId, account, coworker: { id: coworker.id, name: coworker.name } }

    if (entry.sharedWithAll) {
        return {
            ...result,
            attached: true,
            changed: false,
            message: attached ? `${coworker.name} already gets ${account}: it is shared with every coworker.` : `${account} is shared with every coworker, so it cannot be taken back from ${coworker.name} alone. ${PANEL_ONLY}`,
        }
    }
    if (holds(entry, agentId) === attached) return { ...result, attached, changed: false, message: `${coworker.name} ${attached ? 'already has' : 'does not have'} ${account}.` }

    if (attached) await attachVaultEntry(itemId, agentId, actor)
    else await detachVaultEntry(itemId, agentId, actor)
    return { ...result, attached, changed: true, message: attached ? `${coworker.name} now uses ${account}, from its next run.` : `${coworker.name} no longer uses ${account}. It stays in the Vault.` }
}

export async function dispatchForemanVaultTool(actor: Actor, tool: string, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
        case 'list_vault': {
            const listing = await readVault(actor)
            return listing ? vaultListingView(listing) : UNAVAILABLE
        }
        case 'set_vault_link':
            return setVaultLink(actor, args)
        default:
            throw new Error(`Unknown Vault tool: ${tool}`)
    }
}

// Before the foreman declares an app on a coworker: the accounts of that app the Vault already holds.
// One the coworker already draws from is the answer, rather than a copy declared in its own folder.
// The others are only named: one may be another member's account, so the foreman asks before
// lending it. Null lets the declaration go through.
export async function vaultAccountsToLend(actor: Actor, args: Record<string, unknown>) {
    if (args.newAccount === true || args.newAccount === 'true') return null
    const slug = requireString(args.slug, 'slug')
    const agentId = requireString(args.agentId, 'agentId')
    const listing = await readVault(actor)
    if (!listing) return null

    const sameApp = listing.entries.filter(entry => entry.kind === 'service' && entry.slug === slug)
    if (sameApp.length === 0) return null
    const held = sameApp.find(entry => holds(entry, agentId))
    if (held) {
        const account = held.label ? `${held.name} (${held.label})` : held.name
        return { declared: false, slug, itemId: held.id, status: held.status, message: `The coworker already uses ${account} from the Vault${held.sharedWithAll ? ', shared with every coworker' : ''}. Nothing to declare.${held.status === 'active' ? '' : ' The account waits on someone: connect_app or the Vault panel signs it back in.'}` }
    }
    const one = sameApp.length === 1
    return {
        declared: false,
        slug,
        vault: sameApp.map(entry => ({
            itemId: entry.id,
            ...(entry.label ? { account: entry.label } : {}),
            status: entry.status,
            coworkers: entry.coworkers.map(coworker => coworker.name),
            ...(entry.hiddenCoworkers > 0 ? { hiddenCoworkers: entry.hiddenCoworkers } : {}),
        })),
        message: `Nothing was declared: the Vault already holds ${one ? 'an account' : `${sameApp.length} accounts`} of ${sameApp[0].name}. Ask the user whether to lend ${one ? 'it' : 'one of them'} to this coworker, naming the account since it may be someone else's (request_approval, then set_vault_link), or to connect another account (attach_connector again with newAccount: true).`,
    }
}
