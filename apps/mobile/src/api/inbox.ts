import { inboxSchema, type Inbox } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchInbox(caller: Caller): Promise<Inbox> {
    return inboxSchema.parse(await api('/api/v1/inbox', caller))
}

export async function markInboxRead(caller: Caller, sessionIds: string[] | 'all'): Promise<void> {
    await api('/api/v1/inbox/read', { ...caller, method: 'POST', body: sessionIds === 'all' ? { all: true } : { sessionIds } })
}
