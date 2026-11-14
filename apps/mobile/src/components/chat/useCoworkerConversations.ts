import type { Conversation } from '@rerun/contracts'
import { useCallback, useEffect, useId, useState } from 'react'

import { fetchAgentConversations } from '@/api/chat'
import { useAuth } from '@/auth/AuthProvider'
import { readCoworkerScreen, saveCoworkerScreen } from '@/data/local-cache'
import { useLiveReload } from '@/data/useLiveReload'

export function useCoworkerConversations(agentId: string): { conversations: Conversation[]; loaded: boolean; reload: () => void } {
    const { session, me } = useAuth()
    const [kept] = useState(() => (me ? readCoworkerScreen(me.workspace.id, agentId).conversations : null))
    const [conversations, setConversations] = useState<Conversation[]>(kept ?? [])
    const [loaded, setLoaded] = useState(!!kept)
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
