import { mobileApi, type CoworkerVaultAccounts } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function readVaultAccounts(caller: Caller, agentId: string): Promise<CoworkerVaultAccounts> {
    return hub(mobileApi.listVaultAccounts, { ...caller, params: { id: agentId } })
}

export async function lendVaultAccount(caller: Caller, agentId: string, itemId: string): Promise<void> {
    await hub(mobileApi.lendVaultAccount, { ...caller, params: { id: agentId }, body: { itemId } })
}
