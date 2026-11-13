import 'server-only'

import type { VaultItemSummary } from '@rerun/contracts'

import { deleteMcpToken, putMcpToken, supportsVault, type McpTokenBundle } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { deleteVaultToken, listVaultItems, putVaultToken } from '@/lib/engine/vault-client'

function holdsServer(item: VaultItemSummary, serverName: string): boolean {
    return item.mcpServers.some(server => server.name === serverName) || [item.oauth?.serverName, item.managed?.serverName].includes(serverName)
}

// The Vault item a coworker draws this server from, or null when the server is the coworker's own
// (or the box keeps no Vault). The run dials the item's server and reads the item's token, so a
// sign-in made from the coworker has to land there.
export async function vaultItemHoldingServer(conn: EngineConnection, engineAgentId: string, serverName: string): Promise<VaultItemSummary | null> {
    if (!(await supportsVault(conn))) return null
    const items = await listVaultItems(conn, engineAgentId)
    return items.find(item => holdsServer(item, serverName)) ?? null
}

export async function putConnectorToken(conn: EngineConnection, engineAgentId: string, serverName: string, token: McpTokenBundle): Promise<void> {
    const item = await vaultItemHoldingServer(conn, engineAgentId, serverName)
    if (item) await putVaultToken(conn, item.id, serverName, token)
    else await putMcpToken(conn, engineAgentId, serverName, token)
}

export async function deleteConnectorToken(conn: EngineConnection, engineAgentId: string, serverName: string): Promise<void> {
    const item = await vaultItemHoldingServer(conn, engineAgentId, serverName)
    if (item) await deleteVaultToken(conn, item.id, serverName)
    else await deleteMcpToken(conn, engineAgentId, serverName)
}
