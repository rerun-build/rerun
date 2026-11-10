'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { NotificationKind } from '@/lib/engine/types'
import { CalendarClock } from '@/lib/icons'
import { NotificationToast } from '@/components/notifications/NotificationToast'
import { errorHeadline } from '@/lib/notifications/attention-details'
import { noticeText } from '@/lib/notifications/notice-copy'
import { ANNOUNCED_STATUS, FINISHED_STATUS } from '@/lib/notifications/announcement'
import { playNotificationSoundOnce, showBrowserNotification } from '@/lib/notifications/browser'
import { KIND_BEAM, KIND_ICONS, KIND_ICON_COLORS } from '@/lib/notifications/kind-visuals'
import { openConversationFromNotification } from '@/lib/notifications/open-conversation'
import { isScheduledSource, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { deliveryFor, recipientReason } from '@/lib/notifications/routing'
import { useBoardStore } from '@/stores/board.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

// Turns incoming `notifications` rows into a hub announcement, an optional sound, and (when the tab
// is hidden) an OS notification. The hub already decided who a row reaches and why; this only picks
// how loud, from the user's channels. An anonymous user has no hub to announce in: they keep the toast.
export function useNotificationsRealtime(workspaceId: number | undefined) {
    const { user, isAnonymous } = useSession()
    const anonymousRef = useRef(isAnonymous)
    useEffect(() => {
        anonymousRef.current = isAnonymous
    }, [isAnonymous])
    const prefsRef = useRef(user?.email_notification_prefs)
    useEffect(() => {
        prefsRef.current = user?.email_notification_prefs
    }, [user?.email_notification_prefs])
    const userIdRef = useRef(user?.id)
    useEffect(() => {
        userIdRef.current = user?.id
    }, [user?.id])
    const tErrors = useTranslations('chatErrors')
    const tErrorsRef = useRef(tErrors)
    useEffect(() => {
        tErrorsRef.current = tErrors
    }, [tErrors])
    const t = useTranslations('notifications.toast')
    const tNotices = useTranslations('notifications.notices')
    const copyRef = useRef({ t, tNotices })
    useEffect(() => {
        copyRef.current = { t, tNotices }
    }, [t, tNotices])

    useRealtimeSubscription('notifications', {
        channelId: `notifications-ws-${workspaceId}`,
        filter: workspaceId ? { column: 'workspace_id', value: workspaceId } : undefined,
        enabled: !!workspaceId,
        onInsert: row => {
            const kind = row.kind as NotificationKind
            const reason = recipientReason(row.recipients, userIdRef.current)
            if (!reason) return
            if (kind === 'done' && reason !== 'legacy') void useUnseenRunsStore.getState().refresh()
            // A row stored by a hub that predates recipients names nobody: a quiet toast, never a sound.
            const delivery = reason === 'legacy' ? 'toast' : deliveryFor(prefsRef.current, reason, kind, row.agent_id)
            if (delivery === 'none') return
            // A run finishing in the conversation panel the user is looking at is already on screen.
            // The panel is known per coworker, not per conversation: a run of the same coworker in
            // another tab goes quiet too, which is rare enough.
            if (kind === 'done' && isWatching(row.agent_id)) return

            const agent = row.agent_id ? useBoardStore.getState().agents.find(a => a.id === row.agent_id) : undefined
            const agentName = agent?.name ?? copyRef.current.t('coworker')
            const scheduled = isScheduledSource(row.source)
            const title = scheduled ? copyRef.current.t('scheduledTask', { name: agentName }) : agentName
            const message = noticeText(row, copyRef.current.tNotices)

            const Icon = scheduled ? CalendarClock : KIND_ICONS[kind]
            const iconColor = scheduled ? 'text-violet-400' : KIND_ICON_COLORS[kind]
            const beamTone = scheduled ? 'brand' : KIND_BEAM[kind]
            const status = kind === 'done' ? FINISHED_STATUS : ANNOUNCED_STATUS[kind]
            const shown = normalizeNotificationPrefs(prefsRef.current).toast && !!status
            const openConversation = row.agent_id
                ? () => openConversationFromNotification({ agentId: row.agent_id, engineSessionId: row.engine_session_id, engineRunId: row.engine_run_id })
                : undefined
            if (shown && anonymousRef.current) {
                toast.custom(id => (
                    <NotificationToast
                        title={title}
                        message={message}
                        agentId={row.agent_id}
                        Icon={Icon}
                        iconColor={iconColor}
                        beamTone={beamTone}
                        onDismiss={() => toast.dismiss(id)}
                        onOpen={openConversation && (() => {
                            toast.dismiss(id)
                            void openConversation()
                        })}
                    />
                ))
            } else if (shown && status) {
                useNotificationsStore.getState().announce({
                    id: row.id,
                    agentId: row.agent_id,
                    status,
                    headline: kind === 'error' ? errorHeadline(row, tErrorsRef.current) : message,
                    message,
                    engineSessionId: row.engine_session_id,
                    engineRunId: row.engine_run_id,
                    createdAt: row.created_at,
                })
            }

            if (delivery === 'sound') playNotificationSoundOnce(row.id)
            if (shown || delivery === 'sound') showBrowserNotification({ title, body: message, tag: row.id, onClick: openConversation })
        },
    })
}

function isWatching(agentId: string | null): boolean {
    if (!agentId || typeof document === 'undefined') return false
    return useBoardStore.getState().selectedAgentId === agentId && document.hasFocus() && document.visibilityState === 'visible'
}
