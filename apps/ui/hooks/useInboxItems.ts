import { FOREMAN_AGENT_ID, needsHuman } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { useForemanThreads } from '@/components/foreman/useForemanThreads'
import { useForemanName } from '@/hooks/useForemanName'
import { selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useAttentionSessions, type AttentionSession } from '@/hooks/useAttentionSessions'
import { useUnseenGroups } from '@/hooks/useUnseenGroups'
import type { SessionStatus } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'

// A `done` row is one finished conversation, or every unseen run of one scheduled task, so it
// carries the sessions it stands for.
export type InboxItem = Omit<AttentionSession, 'status'> & { status: SessionStatus | 'done'; agentName: string; count?: number; sessionIds?: string[]; latestSessionId?: string }

/** What waits for the person in this workspace: the questions and approvals that reached them, then the finished runs they have not seen. */
export function useInboxItems(): { items: InboxItem[]; sessions: AttentionSession[] } {
    const agents = useBoardStore(s => s.agents)
    const sessions = useAttentionSessions()
    const unseen = useUnseenGroups()
    // The Chief of Staff's conversations are the reader's own, and wait on nobody else.
    const foremanName = useTranslations('workspaceView.foreman')('name', useForemanName())
    const foremanOnEngine = useForemanStore(s => selectForemanVisible(s) && s.surface === 'engine')
    const { entries: foremanEntries } = useForemanThreads(foremanOnEngine)

    const items = useMemo<InboxItem[]>(() => {
        const names = new Map(agents.map(a => [a.id, a.name]))
        const attention = sessions.flatMap(s => {
            const agentName = names.get(s.agentId)
            return agentName && s.reason ? [{ ...s, agentName }] : []
        })
        const done = unseen.flatMap(group => {
            const agentName = names.get(group.agentId)
            if (!agentName) return []
            return [{
                id: `done:${group.key}`,
                agentId: group.agentId,
                agentName,
                engineSessionId: null,
                status: 'done' as const,
                title: group.label,
                message: group.scheduled ? null : group.message,
                updatedAt: new Date(group.at).toISOString(),
                count: group.count,
                sessionIds: group.sessionIds,
                latestSessionId: group.latestSessionId,
            }]
        })
        const foreman = foremanEntries.flatMap(entry =>
            entry.id && needsHuman(entry.status) ? [{ id: entry.id, agentId: FOREMAN_AGENT_ID, agentName: foremanName, engineSessionId: entry.engineSessionId, status: entry.status, title: entry.title, message: null, updatedAt: entry.updatedAt, reason: 'mine' as const }] : []
        )
        return [...foreman, ...attention, ...done]
    }, [sessions, agents, unseen, foremanEntries, foremanName])

    return { items, sessions }
}

export function inboxCount(items: readonly InboxItem[]): number {
    return items.reduce((sum, item) => sum + (item.count ?? 1), 0)
}
