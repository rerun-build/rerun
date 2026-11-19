import { conversationHitSchema, type ConversationHit } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function searchConversations(caller: Caller, query: string): Promise<ConversationHit[]> {
    return conversationHitSchema.array().parse(await api(`/api/v1/conversations/search?q=${encodeURIComponent(query)}`, caller))
}
