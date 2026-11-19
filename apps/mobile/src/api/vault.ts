import { coworkerVaultAccountsSchema, type CoworkerVaultAccounts } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const vault = (agentId: string) => `/api/v1/agents/${encodeURIComponent(agentId)}/vault`

export async function readVaultAccounts(caller: Caller, agentId: string): Promise<CoworkerVaultAccounts> {
    return coworkerVaultAccountsSchema.parse(await api(vault(agentId), caller))
}

export async function lendVaultAccount(caller: Caller, agentId: string, itemId: string): Promise<void> {
    await api(vault(agentId), { ...caller, method: 'POST', body: { itemId } })
}
