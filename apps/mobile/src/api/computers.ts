import type { RemoteComputerRule } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export type ComputerSummary = { id: string; name: string; handle: string; status: 'online' | 'busy' | 'paused' | 'offline' }

// The computers linked to the workspace, for the `#` menu: empty where Computers is not open yet.
export async function listComputers(caller: Caller): Promise<ComputerSummary[]> {
    const res = await api<{ computers: ComputerSummary[] }>('/api/v1/computers', { ...caller, method: 'GET' })
    return res.computers ?? []
}

// "Always allow" on a computer's card, written before the answer goes out.
export async function allowOnComputer(caller: Caller, computerId: string, rule: RemoteComputerRule): Promise<void> {
    await api(`/api/v1/computers/${encodeURIComponent(computerId)}/rules`, { ...caller, method: 'POST', body: rule })
}
