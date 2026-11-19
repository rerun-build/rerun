import { FOREMAN_AGENT_ID, type Conversation } from '@rerun/contracts'
import { useId, useMemo } from 'react'

import { fetchAgentConversations } from '@/api/chat'
import { fetchForemanConversations } from '@/api/foreman'
import { useAuth } from '@/auth/AuthProvider'
import { useHub } from '@/data/hub-store'
import { coworkerScreenPart } from '@/data/local-cache'
import { useBurstReload, useLiveReload } from '@/data/useLiveReload'

// `fresh`: the list is the hub's answer of this launch, not the copy kept from the last visit.
type LiveConversations = { conversations: Conversation[]; loaded: boolean; fresh: boolean; reload: () => void }

const NONE: Conversation[] = []

// A coworker's conversations, newest first, opened on what the last visit read.
export function useCoworkerConversations(agentId: string): LiveConversations {
    return useLiveConversations(agentId)
}

// The Foreman's General and its threads: this person's own, unlike a coworker's.
export function useForemanConversations(): LiveConversations {
    return useLiveConversations(FOREMAN_AGENT_ID)
}

function useLiveConversations(agentId: string): LiveConversations {
    const { session, me } = useAuth()
    const foreman = agentId === FOREMAN_AGENT_ID
    const userId = me?.user.id
    // Two chats of the same coworker can be stacked (a push opens a second one): each needs its own
    // channel, supabase.channel() hands back the existing instance for a topic already taken. They
    // share one list.
    const channelId = useId()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const persisted = useMemo(() => (workspaceId === undefined ? undefined : coworkerScreenPart(workspaceId, agentId, 'conversations')), [workspaceId, agentId])
    const list = useHub(
        accessToken && workspaceId !== undefined ? `conversations:${workspaceId}:${agentId}` : null,
        async () => {
            const caller = { accessToken: accessToken!, workspaceId: workspaceId! }
            const fetched = await (foreman ? fetchForemanConversations(caller) : fetchAgentConversations(caller, agentId))
            return [...fetched].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        },
        { persisted }
    )
    const { reload } = list
    // A run writes its row several times in a row (its status, then its preview, its title): one read for the burst.
    const reloadSoon = useBurstReload(reload)

    // The status moves on the hub while the page is open (a run ends on a question, another one starts
    // on a schedule): the header's menu sorts them by state, so every row of the coworker is followed live.
    // A new one (a routine's run, a webhook, another coworker's request, a chat started on the web)
    // takes its place in General.
    useLiveReload(
        foreman && !userId ? null : `conversations:${agentId}:${channelId}`,
        (channel, changed) => {
            const rows = foreman ? ({ schema: 'public', table: 'foreman_conversations', filter: `user_id=eq.${userId}` } as const) : ({ schema: 'public', table: 'sessions', filter: `agent_id=eq.${agentId}` } as const)
            channel.on('postgres_changes', { event: 'INSERT', ...rows }, changed).on('postgres_changes', { event: 'UPDATE', ...rows }, changed)
        },
        reloadSoon
    )

    return { conversations: list.value ?? NONE, loaded: list.value !== null || list.fresh || list.failed, fresh: list.fresh, reload }
}
