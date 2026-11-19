import { agentKeysListSchema, type AgentKeysList } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const keysOf = (agentId: string) => `/api/v1/agents/${encodeURIComponent(agentId)}/keys`

export async function fetchAgentKeys(caller: Caller, agentId: string): Promise<AgentKeysList> {
    return agentKeysListSchema.parse(await api(keysOf(agentId), caller))
}

export async function saveAgentKeys(caller: Caller, agentId: string, set: Record<string, string>): Promise<AgentKeysList> {
    return agentKeysListSchema.parse(await api(keysOf(agentId), { ...caller, method: 'PUT', body: { set } }))
}
