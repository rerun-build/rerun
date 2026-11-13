import {
    vaultDeleteResultSchema,
    vaultItemSummarySchema,
    vaultItemUsageSchema,
    type CreateVaultItemInput,
    type UpdateVaultItemEnvInput,
    type UpdateVaultItemInput,
    type VaultDeleteResult,
    type VaultItemSummary,
} from '@rerun/contracts'
import { z } from 'zod'

import { request, type McpTokenBundle } from './client'
import type { EngineConnection } from './types'

// The workspace's Vault on its box. No call here ever carries a stored value back: the engine
// answers with names (variables, servers holding a token), a value only travels inbound.

const itemListSchema = z.object({ items: z.array(vaultItemSummarySchema) })
const keysSchema = z.object({ keys: z.array(z.string()) })

const itemPath = (id: string) => `/vault/${encodeURIComponent(id)}`

// `agentId` (the box's own id of a coworker) narrows the list to what that coworker draws on.
export async function listVaultItems(conn: EngineConnection, agentId?: string): Promise<VaultItemSummary[]> {
    const query = agentId ? `?agent=${encodeURIComponent(agentId)}` : ''
    return request(conn, `/vault${query}`, { method: 'GET' }, d => itemListSchema.parse(d).items)
}

export async function getVaultItem(conn: EngineConnection, id: string): Promise<VaultItemSummary> {
    return request(conn, itemPath(id), { method: 'GET' }, d => vaultItemSummarySchema.parse(d))
}

export async function createVaultItem(conn: EngineConnection, input: CreateVaultItemInput): Promise<VaultItemSummary> {
    return request(conn, '/vault', { method: 'POST', body: JSON.stringify(input) }, d => vaultItemSummarySchema.parse(d))
}

export async function patchVaultItem(conn: EngineConnection, id: string, patch: UpdateVaultItemInput): Promise<VaultItemSummary> {
    return request(conn, itemPath(id), { method: 'PATCH', body: JSON.stringify(patch) }, d => vaultItemSummarySchema.parse(d))
}

export async function updateVaultItemEnv(conn: EngineConnection, id: string, input: UpdateVaultItemEnvInput): Promise<string[]> {
    return request(conn, `${itemPath(id)}/env`, { method: 'PATCH', body: JSON.stringify(input) }, d => keysSchema.parse(d).keys)
}

export async function attachVaultItem(conn: EngineConnection, id: string, engineAgentId: string): Promise<VaultItemSummary> {
    return request(conn, `${itemPath(id)}/agents/${encodeURIComponent(engineAgentId)}`, { method: 'PUT' }, d => vaultItemSummarySchema.parse(d))
}

export async function detachVaultItem(conn: EngineConnection, id: string, engineAgentId: string): Promise<VaultItemSummary> {
    return request(conn, `${itemPath(id)}/agents/${encodeURIComponent(engineAgentId)}`, { method: 'DELETE' }, d => vaultItemSummarySchema.parse(d))
}

export async function putVaultToken(conn: EngineConnection, id: string, serverName: string, token: McpTokenBundle): Promise<void> {
    await request(conn, `${itemPath(id)}/tokens/${encodeURIComponent(serverName)}`, { method: 'PUT', body: JSON.stringify(token) }, () => null)
}

export async function deleteVaultToken(conn: EngineConnection, id: string, serverName: string): Promise<void> {
    await request(conn, `${itemPath(id)}/tokens/${encodeURIComponent(serverName)}`, { method: 'DELETE' }, () => null)
}

export async function getVaultItemUsage(conn: EngineConnection, id: string): Promise<string[]> {
    return request(conn, `${itemPath(id)}/usage`, { method: 'GET' }, d => vaultItemUsageSchema.parse(d).agentIds)
}

export async function deleteVaultItem(conn: EngineConnection, id: string): Promise<VaultDeleteResult> {
    return request(conn, itemPath(id), { method: 'DELETE' }, d => vaultDeleteResultSchema.parse(d))
}
