import { mobileApi, type ComputerSummary, type RemoteComputerRule } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export type { ComputerSummary }

// The computers linked to the workspace, for the `#` menu: empty where Computers is not open yet.
export async function listComputers(caller: Caller): Promise<ComputerSummary[]> {
    return (await hub(mobileApi.listComputers, caller)).computers
}

// "Always allow" on a computer's card, written before the answer goes out.
export async function allowOnComputer(caller: Caller, computerId: string, rule: RemoteComputerRule): Promise<void> {
    await hub(mobileApi.allowOnComputer, { ...caller, params: { id: computerId }, body: rule })
}
