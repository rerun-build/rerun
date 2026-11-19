import { mobileApi } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

// The "Always allow" of a spend card: the coworker then buys paid data without asking again.
export async function setPaidDataAlwaysAllow(caller: Caller, agentId: string, alwaysAllow: boolean): Promise<void> {
    await hub(mobileApi.setPaidDataAlwaysAllow, { ...caller, params: { id: agentId }, body: { alwaysAllow } })
}
