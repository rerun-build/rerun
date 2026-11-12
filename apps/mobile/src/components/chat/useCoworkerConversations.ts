import type { Conversation } from '@rerun/contracts'
import { useCallback, useEffect, useId, useState } from 'react'

import { fetchAgentConversations } from '@/api/chat'
import { useAuth } from '@/auth/AuthProvider'
import { readCoworkerScreen, saveCoworkerScreen } from '@/data/local-cache'
import { useLiveReload } from '@/data/useLiveReload'

// A coworker's conversations, newest first, opened on what the last visit read.
export function useCoworkerConversations(agentId: string): { conversations: Conversation[]; loaded: boolean; reload: () => void } {
    const { session, me } = useAuth()
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
        fetchAgentConversations({ accessToken, workspaceId }, agentId)
            .then(list => {
                const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                setConversations(sorted)
                saveCoworkerScreen(workspaceId, agentId, { conversations: sorted })
            })
            .catch(() => {})
            .finally(() => setLoaded(true))
    }, [accessToken, workspaceId, agentId])

    useEffect(reload, [reload])

    // The status moves on the hub while the page is open (a run ends on a question, another one starts
    // on a schedule): the header's menu sorts them by state, so every row of the coworker is followed live.
    // A new one (a routine's run, a webhook, another coworker's request, a chat started on the web)
    // takes its place in General.
    useLiveReload(
        `conversations:${agentId}:${channelId}`,
        (channel, changed) => {
            const sessions = { schema: 'public', table: 'sessions', filter: `agent_id=eq.${agentId}` } as const
            channel.on('postgres_changes', { event: 'INSERT', ...sessions }, changed).on('postgres_changes', { event: 'UPDATE', ...sessions }, changed)
        },
        reload
    )

    return { conversations, loaded, reload }
}
