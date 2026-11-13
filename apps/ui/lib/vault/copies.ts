import 'server-only'

import type { EngineConnection } from '@/lib/engine/types'
import { decompileService } from '@/lib/services/compiler'
import { readOwnRegistry, readRegistry, removeRegistryEntry, sharedSkillSlugs, type RegistryEntry, type ServiceRegistry } from '@/lib/services/registry'

// The engine moved every app a coworker had installed itself into the Vault, and left the coworker's
// own copy in its folder until a later version, for an engine put back in place. The Vault hides that
// copy; once the coworker stops holding the item, the copy would come back. It goes with the item.
//
// The engine leaves a paid app and a Composio account in the coworker's folder: an entry of the
// coworker's own under the item's key is then an account it connected itself, never a copy, unless
// it is the very Composio account the item holds. It stays, and is the coworker's again once the
// item is gone.
export async function decompileMigrationCopy(conn: EngineConnection, engineAgentId: string, key: string, item: Pick<RegistryEntry, 'composio'>, registry?: ServiceRegistry): Promise<boolean> {
    const ownCopy = (await readOwnRegistry(conn, engineAgentId)).services[key]
    if (!ownCopy || ownCopy.app) return false
    const sameAccount = !!ownCopy.composio?.connectedAccountId && ownCopy.composio.connectedAccountId === item.composio?.connectedAccountId
    if (ownCopy.composio && !sameAccount) return false
    // The item kept the Composio account the coworker connected: it is not the copy's to revoke.
    const composio = ownCopy.composio ? { ...ownCopy.composio, connectedAccountId: undefined } : undefined
    await decompileService(conn, engineAgentId, { ...ownCopy, ...(composio ? { composio } : {}) }, { keepSkills: sharedSkillSlugs(registry ?? (await readRegistry(conn, engineAgentId)), key) })
    return true
}

// Once the coworker no longer holds the item: its copy torn down and dropped from its registry.
export async function dropMigrationCopy(conn: EngineConnection, engineAgentId: string, key: string, item: Pick<RegistryEntry, 'composio'>): Promise<void> {
    if (await decompileMigrationCopy(conn, engineAgentId, key, item)) await removeRegistryEntry(conn, engineAgentId, key)
}
