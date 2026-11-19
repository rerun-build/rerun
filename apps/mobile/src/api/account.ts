import { accountDeletionStatusSchema, meSchema, workspaceSummarySchema, type Me, type WorkspaceSummary } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId?: number | null }

export async function fetchMe({ accessToken, workspaceId }: Caller): Promise<Me> {
    return meSchema.parse(await api('/api/v1/me', { accessToken, workspaceId }))
}

export async function fetchWorkspaces({ accessToken }: Caller): Promise<WorkspaceSummary[]> {
    return workspaceSummarySchema.array().parse(await api('/api/v1/workspaces', { accessToken }))
}

export async function fetchDeletionBlockers({ accessToken }: Caller) {
    return accountDeletionStatusSchema.parse(await api('/api/v1/me/account', { accessToken })).blockers
}

export async function deleteAccount({ accessToken }: Caller): Promise<void> {
    await api('/api/v1/me/account', { method: 'DELETE', accessToken, body: { confirmation: 'DELETE' } })
}
