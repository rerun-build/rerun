import { mobileApi, type AgentKeysList } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

// The names of the variables already on the Box, so a form can say which one it would replace. A
// value never comes back.
export async function fetchAgentKeys(caller: Caller, agentId: string): Promise<AgentKeysList> {
    return hub(mobileApi.getAgentKeys, { ...caller, params: { id: agentId } })
}

export async function saveAgentKeys(caller: Caller, agentId: string, set: Record<string, string>): Promise<AgentKeysList> {
    return hub(mobileApi.updateAgentKeys, { ...caller, params: { id: agentId }, body: { set } })
}
