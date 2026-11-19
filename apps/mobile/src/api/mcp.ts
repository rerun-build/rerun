import { connectTargetSchema, mcpServerViewSchema, type ConnectTarget, type McpServerView } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const one = (agentId: string, name: string) => `/api/v1/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(name)}`

export async function readMcpServer(caller: Caller, agentId: string, name: string): Promise<McpServerView> {
    return mcpServerViewSchema.parse(await api(one(agentId, name), caller))
}

export async function connectMcpServer(caller: Caller, agentId: string, name: string): Promise<ConnectTarget> {
    return connectTargetSchema.parse(await api(`${one(agentId, name)}/connect`, { ...caller, method: 'POST' }))
}

export async function claimMcpSignIn(caller: Caller, agentId: string, name: string, claim: string): Promise<void> {
    await api(`${one(agentId, name)}/authorized`, { ...caller, method: 'POST', body: { claim } })
}
