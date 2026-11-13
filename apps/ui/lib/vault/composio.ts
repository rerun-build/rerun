import 'server-only'

import { isVaultItemId, parseServiceRegistryKey, type VaultItemSummary } from '@rerun/contracts'

import { composioUserId, composioVaultOwnUserId, parseCoworkerComposioUserId } from '@/lib/composio/client'
import type { EngineConnection } from '@/lib/engine/types'
import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// The Composio user a Vault entry's account lives under. The box writes the entry, and the hub's
// Composio key acts for any user, so nothing the box says is taken as is: an entry migrated from a
// coworker keeps that coworker's user (nobody signs in again) only once the coworker is proven to
// belong to the authenticated workspace, and every other entry gets one of its own, under that workspace.
export async function composioVaultUserId(workspaceId: number, item: Pick<VaultItemSummary, 'id' | 'composio'>): Promise<string> {
    if (!isVaultItemId(item.id)) throw new Error('Invalid Vault entry id')
    const claimed = item.composio?.userId
    if (claimed) {
        const coworker = parseCoworkerComposioUserId(claimed)
        if (coworker) {
            const { data: agent } = await selectMaybeSingle(createServiceRoleClient(), 'agents', ['id'] as const, { id: coworker.agentId, workspace_id: workspaceId })
            if (agent) return composioUserId(agent.id, coworker.instanceId)
        }
        console.warn(`[vault] entry ${item.id} of workspace ${workspaceId} names a Composio user outside it, using its own`)
    }
    return composioVaultOwnUserId(workspaceId, item.id)
}

// The Composio user behind a coworker's connector key: the entry's when the Vault lends it, the
// coworker's own (per account) otherwise.
export async function composioUserForKey(conn: EngineConnection, workspaceId: number, engineAgentId: string, agentId: string, key: string): Promise<string> {
    const entry = (await readRegistry(conn, engineAgentId)).services[key]
    if (entry?.vaultItemId) return composioVaultUserId(workspaceId, await getVaultItem(conn, entry.vaultItemId))
    return composioUserId(agentId, parseServiceRegistryKey(key).instanceId)
}
