import { mobileApi, type AgentConversationsOverview, type BoardAgent, type Box, type CreateCoworkerInput, type CreatedCoworker } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchBoardAgents(caller: Caller): Promise<BoardAgent[]> {
    return hub(mobileApi.listAgents, caller)
}

export async function fetchConversationsOverview(caller: Caller): Promise<AgentConversationsOverview> {
    return hub(mobileApi.getConversationsOverview, caller)
}

export async function fetchBoxes(caller: Caller): Promise<Box[]> {
    return hub(mobileApi.listBoxes, caller)
}

// The Home in one read: its coworkers, the latest conversation of each, and the Boxes they sit in.
export type BoardRead = { agents: BoardAgent[]; overview: AgentConversationsOverview; boxes: Box[] }

export async function fetchBoard(caller: Caller): Promise<BoardRead> {
    const [agents, overview, boxes] = await Promise.all([fetchBoardAgents(caller), fetchConversationsOverview(caller), fetchBoxes(caller)])
    return { agents, overview, boxes }
}

export async function createCoworker(caller: Caller, input: CreateCoworkerInput): Promise<CreatedCoworker> {
    return hub(mobileApi.createAgent, { ...caller, body: input })
}
