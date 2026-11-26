'use client'

import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import type { NotificationKind } from '@/lib/engine/types'
import { errorHeadline } from '@/lib/notifications/attention-details'
import { noticeText } from '@/lib/notifications/notice-copy'
import { ANNOUNCED_STATUS, FINISHED_STATUS } from '@/lib/notifications/announcement'
import { useBrand } from '@/components/brand/BrandProvider'
import { appIconUrl } from '@/lib/brand/icons'
import { playNotificationSoundOnce, showBrowserNotification } from '@/lib/notifications/browser'
import { openConversationFromNotification } from '@/lib/notifications/open-conversation'
import { scriptRoutineSlugOf } from '@/lib/notifications/inbound'
import { isScheduledSource, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { deliveryFor, recipientReason } from '@/lib/notifications/routing'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

// Turns incoming `notifications` rows into a hub announcement, an optional sound, and (when the tab
// is hidden) an OS notification. The hub already decided who a row reaches and why; this only picks
// how loud, from the user's channels.
export function useNotificationsRealtime(workspaceId: number | undefined) {
    const { user } = useSession()
    const iconUrl = appIconUrl(useBrand())
    const iconUrlRef = useRef(iconUrl)
    useEffect(() => {
        iconUrlRef.current = iconUrl
    }, [iconUrl])
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
            const fromForeman = row.engine_agent_id === FOREMAN_AGENT_ID
            // The Chief of Staff answers and asks in its own column: in the browser, only its heads-ups
            // reach further, under no coworker of the board.
            if (fromForeman && kind !== 'info') return
            // A row stored by a hub that predates recipients names nobody: a quiet toast, never a sound.
            const delivery = reason === 'legacy' ? 'toast' : deliveryFor(prefsRef.current, reason, kind, fromForeman ? FOREMAN_AGENT_ID : row.agent_id)
            if (delivery === 'none') return
            // A run finishing in the conversation panel the user is looking at is already on screen.
            // The panel is known per coworker, not per conversation: a run of the same coworker in
            // another tab goes quiet too, which is rare enough.
            if (kind === 'done' && isWatching(row.agent_id)) return

            const agent = row.agent_id && !fromForeman ? useBoardStore.getState().agents.find(a => a.id === row.agent_id) : undefined
            const agentName = fromForeman ? (useForemanStore.getState().name ?? FOREMAN_DISPLAY_NAME) : (agent?.name ?? copyRef.current.t('coworker'))
            const scheduled = isScheduledSource(row.source)
            const title = scheduled ? copyRef.current.t('scheduledTask', { name: agentName }) : agentName
            const message = noticeText(row, copyRef.current.tNotices)

            const status = kind === 'done' ? FINISHED_STATUS : ANNOUNCED_STATUS[kind]
            const shown = normalizeNotificationPrefs(prefsRef.current).toast && !!status
            const scriptSlug = scriptRoutineSlugOf(row.metadata)
            const openConversation =
                row.agent_id || fromForeman ? () => openConversationFromNotification({ agentId: row.agent_id, engineAgentId: row.engine_agent_id, engineSessionId: row.engine_session_id, engineRunId: row.engine_run_id, scriptSlug }) : undefined
            if (shown && status) {
                useNotificationsStore.getState().announce({
                    id: row.id,
                    agentId: fromForeman ? null : row.agent_id,
                    status,
                    headline: kind === 'error' ? errorHeadline(row, tErrorsRef.current) : message,
                    message,
                    engineSessionId: row.engine_session_id,
                    engineRunId: row.engine_run_id,
                    scriptSlug,
                    createdAt: row.created_at,
                })
            }

            if (delivery === 'sound') playNotificationSoundOnce(row.id)
            if (shown || delivery === 'sound') showBrowserNotification({ title, body: message, tag: row.id, icon: iconUrlRef.current, onClick: openConversation })
        },
    })
}

function isWatching(agentId: string | null): boolean {
    if (!agentId || typeof document === 'undefined') return false
    return useBoardStore.getState().selectedAgentId === agentId && document.hasFocus() && document.visibilityState === 'visible'
}
