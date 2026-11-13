import 'server-only'

import type { EngineConnection } from '@/lib/engine/types'
import { decompileService } from '@/lib/services/compiler'
import { readOwnRegistry, readRegistry, removeRegistryEntry, sharedSkillSlugs, type RegistryEntry, type ServiceRegistry } from '@/lib/services/registry'

// The engine moved every app a coworker had installed itself into the Vault, and left the coworker's
// own copy in its folder until a later version, for an engine put back in place. The Vault hides that
// copy; once the coworker stops holding the item, the copy would come back. It goes with the item.
export async function decompileMigrationCopy(conn: EngineConnection, engineAgentId: string, key: string, item: Pick<RegistryEntry, 'composio'>, registry?: ServiceRegistry): Promise<boolean> {
    const ownCopy = (await readOwnRegistry(conn, engineAgentId)).services[key]
    if (!ownCopy) return false
    // The item kept the Composio account the coworker connected: it is not the copy's to revoke.
    const composio = ownCopy.composio && ownCopy.composio.connectedAccountId === item.composio?.connectedAccountId ? { ...ownCopy.composio, connectedAccountId: undefined } : ownCopy.composio
    await decompileService(conn, engineAgentId, { ...ownCopy, ...(composio ? { composio } : {}) }, { keepSkills: sharedSkillSlugs(registry ?? (await readRegistry(conn, engineAgentId)), key) })
    return true
}

// Once the coworker no longer holds the item: its copy torn down and dropped from its registry.
export async function dropMigrationCopy(conn: EngineConnection, engineAgentId: string, key: string, item: Pick<RegistryEntry, 'composio'>): Promise<void> {
    if (await decompileMigrationCopy(conn, engineAgentId, key, item)) await removeRegistryEntry(conn, engineAgentId, key)
}
