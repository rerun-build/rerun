import { mobileApi, type Me, type WorkspaceSummary } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId?: number | null }

export async function fetchMe({ accessToken, workspaceId }: Caller): Promise<Me> {
    return hub(mobileApi.getMe, { accessToken, workspaceId })
}

export async function fetchWorkspaces({ accessToken }: Caller): Promise<WorkspaceSummary[]> {
    return hub(mobileApi.listWorkspaces, { accessToken })
}

export async function fetchDeletionBlockers({ accessToken }: Caller) {
    return (await hub(mobileApi.getAccountDeletion, { accessToken })).blockers
}

export async function deleteAccount({ accessToken }: Caller): Promise<void> {
    await hub(mobileApi.deleteAccount, { accessToken, body: { confirmation: 'DELETE' } })
}
