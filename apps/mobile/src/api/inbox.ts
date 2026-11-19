import { mobileApi, type Inbox } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchInbox(caller: Caller): Promise<Inbox> {
    return hub(mobileApi.getInbox, caller)
}

export async function markInboxRead(caller: Caller, sessionIds: string[] | 'all'): Promise<void> {
    await hub(mobileApi.markInboxRead, { ...caller, body: sessionIds === 'all' ? { all: true } : { sessionIds } })
}
