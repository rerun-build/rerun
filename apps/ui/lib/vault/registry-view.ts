import { serviceRegistryKey, type UpdateVaultItemInput, type VaultItemSummary } from '@rerun/contracts'

import type { RegistryEntry } from '@/lib/services/registry'

// A Vault item, seen from one coworker it is attached to, in the shape of an entry of the coworker's
// own connector registry: every screen, route and tool that reads a coworker's connectors keeps
// reading one registry, whichever of the two places an account lives in.

export function isRegistryItem(item: VaultItemSummary): item is VaultItemSummary & { slug: string } {
    return item.kind === 'service' && !!item.slug
}

export function vaultRegistryKey(item: VaultItemSummary & { slug: string }): string {
    return serviceRegistryKey(item.slug, item.instanceId)
}

export function vaultRegistryEntry(item: VaultItemSummary): RegistryEntry {
    return {
        status: item.status,
        config: item.config,
        ...(item.authMethodId ? { authMethodId: item.authMethodId } : {}),
        mcpServers: item.mcpServers.map(server => server.name),
        envKeys: item.envKeys,
        skills: item.skills.map(skill => skill.slug),
        ...(item.oauth ? { oauth: item.oauth } : {}),
        ...(item.managed ? { managed: item.managed } : {}),
        ...(item.composio ? { composio: item.composio } : {}),
        ...(item.app ? { app: item.app } : {}),
        ...(item.instanceId ? { instanceId: item.instanceId } : {}),
        ...(item.label ? { label: item.label } : {}),
        installedAt: item.createdAt,
        vaultItemId: item.id,
        vaultSharedWithAll: item.sharedWithAll,
    }
}

// What a write to a registry entry changes on the item behind it. The footprint (servers, variables,
// skills) is the item's own and only a recompile replaces it; a sign-in target missing from the
// entry is one the write took away.
export function vaultPatchOf(entry: RegistryEntry): UpdateVaultItemInput {
    return {
        status: entry.status,
        config: entry.config,
        authMethodId: entry.authMethodId ?? null,
        ...(entry.label ? { label: entry.label } : {}),
        oauth: entry.oauth ?? null,
        managed: entry.managed ?? null,
        composio: entry.composio ?? null,
        app: entry.app ?? null,
    }
}
