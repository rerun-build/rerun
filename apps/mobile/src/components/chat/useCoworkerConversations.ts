import { FOREMAN_AGENT_ID, type Conversation } from '@rerun/contracts'
import { useCallback, useEffect, useId, useState } from 'react'

import { fetchAgentConversations } from '@/api/chat'
import { fetchForemanConversations } from '@/api/foreman'
import { useAuth } from '@/auth/AuthProvider'
import { readCoworkerScreen, saveCoworkerScreen } from '@/data/local-cache'
import { useLiveReload } from '@/data/useLiveReload'

type LiveConversations = { conversations: Conversation[]; loaded: boolean; reload: () => void }

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
    const [kept] = useState(() => (me ? readCoworkerScreen(me.workspace.id, agentId).conversations : null))
    const [conversations, setConversations] = useState<Conversation[]>(kept ?? [])
    const [loaded, setLoaded] = useState(!!kept)
    // Two chats of the same coworker can be stacked (a push opens a second one): each needs its own
    // channel, supabase.channel() hands back the existing instance for a topic already taken.
    const channelId = useId()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    const reload = useCallback(() => {
        if (!accessToken || !workspaceId) return
        const caller = { accessToken, workspaceId }
        ;(foreman ? fetchForemanConversations(caller) : fetchAgentConversations(caller, agentId))
            .then(list => {
                const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                setConversations(sorted)
                saveCoworkerScreen(workspaceId, agentId, { conversations: sorted })
            })
            .catch(() => {})
            .finally(() => setLoaded(true))
    }, [accessToken, workspaceId, agentId, foreman])

    useEffect(reload, [reload])

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
        reload
    )

    return { conversations, loaded, reload }
}
