import 'server-only'

import type { Actor } from '@/app/api/_auth/access'
import { dispatchShareTool } from './mcp-shares.service'
import { vaultPaidAccounts, type VaultPaidAccount } from './vault-apps.service'
import { listVault, VaultUnavailableError, type VaultCoworker, type VaultEntryView, type VaultListing } from './vault.service'
import { NoEngineError } from './workspace-engine.service'

const UNAVAILABLE = {
    available: false,
    message: "This workspace's machine keeps no Vault yet: every app is connected coworker by coworker. Use list_agent_connectors and attach_connector.",
} as const

const coworkerView = (coworker: Pick<VaultCoworker, 'id' | 'name'>) => ({ id: coworker.id, name: coworker.name })

// What the caller reads of an entry: enough to name it, tell whether it works and who holds it.
// Variable names, token servers, settings, Composio ids and who added it stay out.
function entryView(entry: VaultEntryView) {
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
        canChange: entry.canChange,
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
        available: true,
        entries: listing.entries.map(entryView),
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

// Chained after the account tools and before sharing, whose own default hands over to the template tools.
export async function dispatchVaultTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'list_vault':
            return readVault(actor)
        default:
            return await dispatchShareTool(actor, name, args)
    }
}
