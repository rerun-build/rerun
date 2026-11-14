import type { PaidDataAlwaysAllowInput } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function setPaidDataAlwaysAllow(caller: Caller, agentId: string, alwaysAllow: boolean): Promise<void> {
    const body: PaidDataAlwaysAllowInput = { alwaysAllow }
    await api(`/api/v1/agents/${encodeURIComponent(agentId)}/paid-data`, { ...caller, method: 'PUT', body })
}
