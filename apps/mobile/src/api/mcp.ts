import { mobileApi, type ConnectTarget, type McpServerView } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function readMcpServer(caller: Caller, agentId: string, name: string): Promise<McpServerView> {
    return hub(mobileApi.getMcpServer, { ...caller, params: { id: agentId, name } })
}

export async function connectMcpServer(caller: Caller, agentId: string, name: string): Promise<ConnectTarget> {
    return hub(mobileApi.connectMcpServer, { ...caller, params: { id: agentId, name } })
}

export async function claimMcpSignIn(caller: Caller, agentId: string, name: string, claim: string): Promise<void> {
    await hub(mobileApi.claimMcpSignIn, { ...caller, params: { id: agentId, name }, body: { claim } })
}
