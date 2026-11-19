import {
    aiConnectionCreatedSchema,
    aiConnectionsViewSchema,
    claudeSignInStartSchema,
    codexSignInPollSchema,
    codexSignInStartSchema,
    connectionUsageSchema,
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
} from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const BASE = '/api/v1/ai-connections'

export async function fetchAiConnections(caller: Caller): Promise<AiConnectionsView> {
    return aiConnectionsViewSchema.parse(await api(BASE, caller))
}

export async function createAiConnection(caller: Caller, input: CreateAiConnectionInput): Promise<string> {
    return aiConnectionCreatedSchema.parse(await api(BASE, { ...caller, method: 'POST', body: input })).connectionId
}

export async function updateAiConnection(caller: Caller, connectionId: string, patch: UpdateConnectionInput): Promise<void> {
    await api(`${BASE}/${encodeURIComponent(connectionId)}`, { ...caller, method: 'PATCH', body: patch })
}

export async function replaceAiConnectionKey(caller: Caller, connectionId: string, apiKey: string): Promise<void> {
    await api(`${BASE}/${encodeURIComponent(connectionId)}/keys`, { ...caller, method: 'PUT', body: { apiKey } })
}

export async function fetchAiConnectionUsage(caller: Caller, connectionId: string): Promise<ConnectionUsage> {
    return connectionUsageSchema.parse(await api(`${BASE}/${encodeURIComponent(connectionId)}/usage`, caller))
}

export async function deleteAiConnection(caller: Caller, connectionId: string): Promise<void> {
    await api(`${BASE}/${encodeURIComponent(connectionId)}`, { ...caller, method: 'DELETE' })
}

export async function setWorkspaceDefault(caller: Caller, choice: WorkspaceDefaultInput): Promise<void> {
    await api(`${BASE}/default`, { ...caller, method: 'PUT', body: choice })
}

export async function startClaudeSignIn(caller: Caller): Promise<ClaudeSignInStart> {
    return claudeSignInStartSchema.parse(await api(`${BASE}/claude/start`, { ...caller, method: 'POST' }))
}

export async function finishClaudeSignIn(caller: Caller, input: ClaudeSignInFinishInput): Promise<string> {
    return aiConnectionCreatedSchema.parse(await api(`${BASE}/claude/finish`, { ...caller, method: 'POST', body: input })).connectionId
}

export async function startCodexSignIn(caller: Caller): Promise<CodexSignInStart> {
    return codexSignInStartSchema.parse(await api(`${BASE}/codex/start`, { ...caller, method: 'POST' }))
}

export async function pollCodexSignIn(caller: Caller, input: CodexSignInPollInput): Promise<CodexSignInPoll> {
    return codexSignInPollSchema.parse(await api(`${BASE}/codex/poll`, { ...caller, method: 'POST', body: input }))
}
