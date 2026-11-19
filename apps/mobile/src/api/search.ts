import { mobileApi, type ConversationHit } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function searchConversations(caller: Caller, query: string): Promise<ConversationHit[]> {
    return hub(mobileApi.searchConversations, { ...caller, query: { q: query } })
}
