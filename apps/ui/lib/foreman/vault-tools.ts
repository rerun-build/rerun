import 'server-only'

import type { Actor } from '@/app/api/_auth/access'
import { listVault, VaultUnavailableError, type VaultEntryView, type VaultListing } from '@/app/api/_services/vault.service'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { FOREMAN_VAULT_TOOL_DEFS } from './tool-defs'

export const FOREMAN_VAULT_TOOL_NAMES: ReadonlySet<string> = new Set(FOREMAN_VAULT_TOOL_DEFS.map(def => def.name))

const UNAVAILABLE = {
    available: false,
    message: "This workspace's machine keeps no Vault yet: every app is connected coworker by coworker, from its Apps tab. Use list_agent_connectors and attach_connector.",
} as const

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

export async function dispatchForemanVaultTool(actor: Actor, tool: string, _args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
        case 'list_vault':
            try {
                return vaultListingView(await listVault(actor))
            } catch (err) {
                if (err instanceof VaultUnavailableError || err instanceof NoEngineError) return UNAVAILABLE
                throw err
            }
        default:
            throw new Error(`Unknown Vault tool: ${tool}`)
    }
}
