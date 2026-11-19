import {
    mobileApi,
    type AiConnectionsView,
    type ClaudeSignInFinishInput,
    type ClaudeSignInStart,
    type CodexSignInPoll,
    type CodexSignInPollInput,
    type CodexSignInStart,
    type ConnectionUsage,
    type CreateAiConnectionInput,
    type UpdateConnectionInput,
    type WorkspaceDefaultInput,
} from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchAiConnections(caller: Caller): Promise<AiConnectionsView> {
    return hub(mobileApi.listAiConnections, caller)
}

export async function createAiConnection(caller: Caller, input: CreateAiConnectionInput): Promise<string> {
    return (await hub(mobileApi.createAiConnection, { ...caller, body: input })).connectionId
}

export async function updateAiConnection(caller: Caller, connectionId: string, patch: UpdateConnectionInput): Promise<void> {
    await hub(mobileApi.updateAiConnection, { ...caller, params: { id: connectionId }, body: patch })
}

export async function replaceAiConnectionKey(caller: Caller, connectionId: string, apiKey: string): Promise<void> {
    await hub(mobileApi.replaceAiConnectionKey, { ...caller, params: { id: connectionId }, body: { apiKey } })
}

export async function fetchAiConnectionUsage(caller: Caller, connectionId: string): Promise<ConnectionUsage> {
    return hub(mobileApi.getAiConnectionUsage, { ...caller, params: { id: connectionId } })
}

export async function deleteAiConnection(caller: Caller, connectionId: string): Promise<void> {
    await hub(mobileApi.deleteAiConnection, { ...caller, params: { id: connectionId } })
}

export async function setWorkspaceDefault(caller: Caller, choice: WorkspaceDefaultInput): Promise<void> {
    await hub(mobileApi.setWorkspaceDefaultModel, { ...caller, body: choice })
}

export async function startClaudeSignIn(caller: Caller): Promise<ClaudeSignInStart> {
    return hub(mobileApi.startClaudeSignIn, caller)
}

export async function finishClaudeSignIn(caller: Caller, input: ClaudeSignInFinishInput): Promise<string> {
    return (await hub(mobileApi.finishClaudeSignIn, { ...caller, body: input })).connectionId
}

export async function startCodexSignIn(caller: Caller): Promise<CodexSignInStart> {
    return hub(mobileApi.startCodexSignIn, caller)
}

export async function pollCodexSignIn(caller: Caller, input: CodexSignInPollInput): Promise<CodexSignInPoll> {
    return hub(mobileApi.pollCodexSignIn, { ...caller, body: input })
}
