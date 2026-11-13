import 'server-only'

import { parseServiceRegistryKey, type VaultItemSummary } from '@rerun/contracts'

import { composioUserId } from '@/lib/composio/client'
import type { EngineConnection } from '@/lib/engine/types'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'

// The Composio user a Vault entry's account lives under: the one it was connected with when it came
// from a coworker (a migration keeps it, so nobody signs in again), else one of its own.
export function composioVaultUserId(item: Pick<VaultItemSummary, 'id' | 'composio'>): string {
    return item.composio?.userId ?? `${process.env.COMPOSIO_USER_NAMESPACE || 'local'}_vault_${item.id}`
}

// The Composio user behind a coworker's connector key: the entry's when the Vault lends it, the
// coworker's own (per account) otherwise.
export async function composioUserForKey(conn: EngineConnection, engineAgentId: string, agentId: string, key: string): Promise<string> {
    const entry = (await readRegistry(conn, engineAgentId)).services[key]
    if (entry?.vaultItemId) return composioVaultUserId(await getVaultItem(conn, entry.vaultItemId))
    return composioUserId(agentId, parseServiceRegistryKey(key).instanceId)
}
