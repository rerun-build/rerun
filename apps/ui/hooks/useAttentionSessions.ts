'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ATTENTION_STATUSES } from '@/lib/board/attention'
import type { ChatErrorCopy } from '@/lib/chat-error'
import type { SessionStatus } from '@/lib/board/types'
import { ATTENTION_NOTIFICATION_COLUMNS, attentionDetailsOf, attentionNotificationsFilter, type AttentionDetail } from '@/lib/notifications/attention-details'
import type { NotificationReason } from '@/lib/notifications/routing'
import { useBoardStore } from '@/stores/board.store'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { selectMany } from '@/supabase/supabase-helpers'

export type AttentionSession = {
    id: string
    agentId: string
    engineSessionId: string | null
    status: SessionStatus
    title: string
    /** The question, approval, heads-up or error the agent left for the user, when one was recorded. */
    message: string | null
    updatedAt: string | null
    /**
     * Why the notification that put it here reached the user. `null` when it did not reach them, `legacy` when it was
     * stored before recipients existed or when no notification explains it, `undefined` until loaded.
     */
    reason?: NotificationReason | 'legacy' | null
}

/**
 * What the « To handle » list shows: one agent's sessions waiting on the user, or every agent's when
 * `agentId` is left out. The store only carries ids and statuses, so titles are read on the side.
 */
export function useAttentionSessions(agentId?: string): AttentionSession[] {
    const sessions = useBoardStore(s => s.sessions)
    const { user } = useSession()
    const userId = user?.id
    const tErrors = useTranslations('chatErrors')
    const tInbox = useTranslations('notifications.inbox')
    const tErrorsRef = useRef(tErrors)
    useEffect(() => {
        tErrorsRef.current = tErrors
    }, [tErrors])

    const attention = useMemo(() => sessions.filter(s => ATTENTION_STATUSES.has(s.status) && (!agentId || s.agentId === agentId)), [sessions, agentId])
    const ids = useMemo(() => attention.map(s => s.id).sort().join(','), [attention])

    const [details, setDetails] = useState<Record<string, AttentionDetail>>({})
    useEffect(() => {
        const idList = ids ? ids.split(',') : []
        if (idList.length === 0) return
        let cancelled = false
        loadAttentionDetails(idList, userId, tErrorsRef.current).then(loaded => {
            if (!cancelled && loaded) setDetails(loaded)
        })
        return () => {
            cancelled = true
        }
    }, [ids, userId])

    return useMemo(
        () =>
            attention
                .map(s => ({ id: s.id, agentId: s.agentId, engineSessionId: details[s.id]?.engineSessionId ?? null, status: s.status, title: details[s.id]?.title ?? tInbox('untitledSession'), message: details[s.id]?.message ?? null, updatedAt: details[s.id]?.updatedAt ?? null, reason: details[s.id]?.reason }))
                .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
        [attention, details, tInbox]
    )
}

async function loadAttentionDetails(sessionIds: string[], userId: string | undefined, tErrors: ChatErrorCopy): Promise<Record<string, AttentionDetail> | null> {
    const supabase = createClient()
    const { data: sessions } = await selectMany(supabase, 'sessions', ['id', 'agent_id', 'engine_session_id', 'title', 'updated_at'] as const, { id: { in: sessionIds } })
    if (!sessions) return null

    const filter = attentionNotificationsFilter(sessions)
    const { data: notifications } = filter ? await selectMany(supabase, 'notifications', ATTENTION_NOTIFICATION_COLUMNS, filter, { column: 'created_at', ascending: false }) : { data: [] }

    return attentionDetailsOf(sessions, notifications ?? [], userId, tErrors)
}
