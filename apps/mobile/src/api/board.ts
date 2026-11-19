import { agentConversationsOverviewSchema, boardAgentSchema, boxSchema, createdCoworkerSchema, type AgentConversationsOverview, type BoardAgent, type Box, type CreateCoworkerInput, type CreatedCoworker } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchBoardAgents(caller: Caller): Promise<BoardAgent[]> {
    return boardAgentSchema.array().parse(await api('/api/v1/agents', caller))
}

export async function fetchConversationsOverview(caller: Caller): Promise<AgentConversationsOverview> {
    return agentConversationsOverviewSchema.parse(await api('/api/v1/agents/conversations', caller))
}

export async function fetchBoxes(caller: Caller): Promise<Box[]> {
    return boxSchema.array().parse(await api('/api/v1/boxes', caller))
}

export type BoardRead = { agents: BoardAgent[]; overview: AgentConversationsOverview; boxes: Box[] }

export async function fetchBoard(caller: Caller): Promise<BoardRead> {
    const [agents, overview, boxes] = await Promise.all([fetchBoardAgents(caller), fetchConversationsOverview(caller), fetchBoxes(caller)])
    return { agents, overview, boxes }
}

export async function createCoworker(caller: Caller, input: CreateCoworkerInput): Promise<CreatedCoworker> {
    return createdCoworkerSchema.parse(await api('/api/v1/agents', { ...caller, method: 'POST', body: input }))
}
