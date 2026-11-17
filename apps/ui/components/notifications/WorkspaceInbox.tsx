'use client'

import { InboxSurface as SharedInboxSurface, type InboxAnnouncement, type InboxEntry, type InboxSurfaceProps, type RowMenuProps } from '@rerun/ui/inbox'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { InboxDetailCard } from '@/components/notifications/InboxDetailCard'
import { InboxPeekCard } from '@/components/notifications/InboxPeekCard'
import { InboxRowMenu } from '@/components/notifications/InboxRowMenu'
import { useAttentionSessions, type AttentionSession } from '@/hooks/useAttentionSessions'
import { useInboxAnnouncer } from '@/hooks/useInboxAnnouncer'
import { useInboxPeek, type InboxPeekTarget } from '@/hooks/useInboxPeek'
import { useTabSignals } from '@/hooks/useTabSignals'
import { useUnseenGroups } from '@/hooks/useUnseenGroups'
import type { SessionStatus } from '@/lib/board/types'
import { PEEK_STATUSES } from '@/lib/chat/pending-request-peek'
import type { AnnouncedNotification } from '@/lib/notifications/announcement'
import { openConversationFromNotification } from '@/lib/notifications/open-conversation'
import { reasonSentence } from '@/lib/notifications/reason-copy'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'

// A `done` row is one finished conversation, or every unseen run of one scheduled task, so it
// carries the sessions it stands for.
export type InboxItem = Omit<AttentionSession, 'status'> & { status: SessionStatus | 'done'; agentName: string; count?: number; sessionIds?: string[]; latestSessionId?: string }

// Declared once, outside the inbox: a component reference the memoised rows can compare, where a render function would hand them a new element on every pass.
function InboxItemMenu({ item, onOpenChange }: RowMenuProps<InboxItem>) {
    return <InboxRowMenu agentId={item.agentId} agentName={item.agentName} onOpenChange={onOpenChange} />
}

type Peek = { entry: InboxEntry; target: InboxPeekTarget; engineRunId: string | null }

type View = null | 'hub' | { notification: AnnouncedNotification } | { peek: Peek }

/** Every agent's « To handle » list in one place: a pill in the board's bottom-left corner, or a row at the top of the Simple view's list. */
export function WorkspaceInbox({ trigger = 'pill' }: { trigger?: 'pill' | 'row' }) {
    const t = useTranslations('notifications.inbox')
    const tReasons = useTranslations('notifications.inbox.reasons')
    const onEngine = useForemanStore(state => state.surface === 'engine')
    const agents = useBoardStore(s => s.agents)
    const hydrated = useBoardStore(s => s.hydrated)
    const setSessionStatus = useBoardStore(s => s.setSessionStatus)
    const markSessionsHandled = useBoardStore(s => s.markSessionsHandled)
    const sessions = useAttentionSessions()
    // Until its notification is read, a row may well be someone else's: it waits rather than flashes.
    const reasonsLoaded = sessions.every(s => s.reason !== undefined)

    const unseen = useUnseenGroups()
    const liveSessions = useBoardStore(s => s.sessions)

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
        return [...attention, ...done]
    }, [sessions, agents, unseen])

    const shown = onEngine
    useTabSignals(shown ? items.reduce((sum, item) => sum + (item.count ?? 1), 0) : 0)

    const running = useMemo(() => {
        const known = new Set(agents.map(a => a.id))
        return liveSessions.filter(s => s.status === 'working' && known.has(s.agentId)).map(s => s.agentId)
    }, [liveSessions, agents])

    const [view, setView] = useState<View>(null)
    const [pulse, setPulse] = useState(0)
    const seenIds = useRef<Set<string> | null>(null)
    const idKey = useMemo(() => items.map(i => i.id).join(','), [items])
    useEffect(() => {
        if (!hydrated || !reasonsLoaded) return
        const ids = idKey ? idKey.split(',') : []
        const seen = seenIds.current
        if (seen && ids.some(id => !seen.has(id))) setPulse(value => value + 1)
        seenIds.current = new Set(ids)
    }, [hydrated, reasonsLoaded, idKey])

    const arrivals = useNotificationsStore(s => s.arrivals)
    const { current, dismiss, setHeld } = useInboxAnnouncer(arrivals, view !== null)

    const show = useCallback(
        (next: View) => {
            if (next !== null) dismiss()
            setView(next)
        },
        [dismiss]
    )

    // The notification says what arrived; its row in the list, once loaded, carries the session it belongs to.
    const rowOf = useCallback(
        (notification: AnnouncedNotification) => items.find(i => i.agentId === notification.agentId && i.engineSessionId !== null && i.engineSessionId === notification.engineSessionId),
        [items]
    )
    const entryOf = useCallback(
        (notification: AnnouncedNotification): InboxEntry => ({
            id: notification.id,
            agentId: notification.agentId ?? '',
            agentName: agents.find(a => a.id === notification.agentId)?.name ?? t('unknownCoworker'),
            status: notification.status,
            title: rowOf(notification)?.title ?? '',
            message: notification.headline,
            updatedAt: notification.createdAt,
        }),
        [agents, rowOf, t]
    )

    const announcement = useMemo<InboxAnnouncement | null>(
        () => (current ? { key: `${current.notification.id}-${current.bundled}`, item: entryOf(current.notification), bundled: current.bundled, loud: current.loud } : null),
        [current, entryOf]
    )
    const openAnnouncement = useCallback(() => {
        if (!current) return
        const { notification } = current
        if (current.bundled > 1) return show('hub')
        if (notification.agentId && PEEK_STATUSES.has(notification.status)) {
            return show({ peek: { entry: entryOf(notification), target: { agentId: notification.agentId, sessionId: rowOf(notification)?.id ?? null, engineSessionId: notification.engineSessionId }, engineRunId: notification.engineRunId } })
        }
        show({ notification })
    }, [current, show, entryOf, rowOf])

    const openItem = useCallback((item: InboxItem) => {
        if (PEEK_STATUSES.has(item.status) && !item.sessionIds) {
            setView({ peek: { entry: item, target: { agentId: item.agentId, sessionId: item.id, engineSessionId: item.engineSessionId }, engineRunId: null } })
            return
        }
        setView(null)
        const board = useBoardStore.getState()
        board.focusAgentOnBoard(item.agentId, 'chat')
        board.setPendingOpenSession({ agentId: item.agentId, sessionId: item.latestSessionId ?? item.id, runId: null })
        // The conversation opened marks itself read; the other runs of the same task go with it.
        if (item.sessionIds) void useUnseenRunsStore.getState().markSeen(item.sessionIds)
    }, [])
    const openPeekConversation = useCallback((peek: Peek) => {
        setView(null)
        const { agentId, sessionId, engineSessionId } = peek.target
        if (!sessionId) return void openConversationFromNotification({ agentId, engineSessionId, engineRunId: peek.engineRunId })
        const board = useBoardStore.getState()
        board.focusAgentOnBoard(agentId, 'chat')
        board.setPendingOpenSession({ agentId, sessionId, runId: peek.engineRunId })
    }, [])
    const markRead = useCallback(
        (item: InboxItem) => {
            if (item.sessionIds) void useUnseenRunsStore.getState().markSeen(item.sessionIds)
            else setSessionStatus(item.id, 'idle')
        },
        [setSessionStatus]
    )
    const markAllRead = useCallback(() => {
        markSessionsHandled(items.filter(i => !i.sessionIds).map(i => i.id))
        void useUnseenRunsStore.getState().markAllSeen()
    }, [markSessionsHandled, items])
    const openSettings = useCallback(() => {
        setView(null)
        useNotificationsStore.getState().openNotifications()
    }, [])
    const [rowMenuOpen, setRowMenuOpen] = useState(false)
    const rowReason = useCallback((item: InboxItem) => (item.reason && item.reason !== 'legacy' ? reasonSentence(item.reason, item.agentName, tReasons) : null), [tReasons])

    if (!shown) return null

    const peeking = view !== null && view !== 'hub' && 'peek' in view
    // The peek card holds a widget and the thread around it: wider than the plain detail, never wider
    // than the board it sits on, which the chat column narrows on a tablet.
    const detailClassName = peeking ? (trigger === 'row' ? 'w-[min(26rem,calc(100vw-1.5rem))]' : 'w-[min(420px,calc(100cqw-2rem))]') : trigger === 'row' ? 'w-[min(22rem,calc(100vw-1.5rem))]' : undefined

    let detail: ReactNode = null
    let detailKey: string | undefined
    if (view !== null && view !== 'hub' && 'peek' in view) {
        const { peek } = view
        detailKey = peek.entry.id
        detail = (
            <InboxPeek
                key={peek.entry.id}
                peek={peek}
                anchor={trigger === 'row' ? 'top' : 'bottom'}
                onClose={() => setView(null)}
                onBack={() => setView('hub')}
                onOpenConversation={() => openPeekConversation(peek)}
            />
        )
    } else if (view !== null && view !== 'hub') {
        const { notification } = view
        const row = rowOf(notification)
        const { agentId, engineSessionId, engineRunId } = notification
        detailKey = notification.id
        detail = (
            <InboxDetailCard
                entry={entryOf(notification)}
                message={notification.message}
                total={items.length}
                onClose={() => setView(null)}
                onBack={() => setView('hub')}
                onSeeAll={() => setView('hub')}
                onOpenConversation={
                    agentId
                        ? () => {
                              setView(null)
                              void openConversationFromNotification({ agentId, engineSessionId, engineRunId })
                          }
                        : undefined
                }
                onMarkRead={
                    row
                        ? () => {
                              markRead(row)
                              setView(null)
                          }
                        : undefined
                }
            />
        )
    }

    return (
        <InboxSurface
            items={items}
            running={running}
            open={view === 'hub'}
            onOpenChange={open => show(open ? 'hub' : null)}
            pulse={pulse}
            onOpenItem={openItem}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onOpenSettings={openSettings}
            announcement={announcement}
            onAnnouncementClick={openAnnouncement}
            onAnnouncementHoldChange={setHeld}
            rowReason={rowReason}
            RowMenu={InboxItemMenu}
            onRowMenuOpenChange={setRowMenuOpen}
            // A half-written answer is not lost to a click elsewhere, nor to a portaled picker or tooltip.
            keepOpen={rowMenuOpen || peeking}
            detail={detail}
            detailKey={detailKey}
            trigger={trigger}
            detailClassName={detailClassName}
            // Dropped from the top of the list, the card may reach over the chat, never past the window.
            {...(trigger === 'row' && { resizable: false, listMaxHeight: 'min(28rem, calc(100dvh - 14rem))', cardClassName: 'w-[min(24rem,calc(100vw-1.5rem))]' })}
        />
    )
}

/** The shared surface, with « Mark all as read » asking first: the app's confirm dialog cannot live in `@rerun/ui`. */
export function InboxSurface({ items, onMarkAllRead, keepOpen = false, ...props }: InboxSurfaceProps<InboxItem>) {
    const t = useTranslations('notifications.inbox.markAll')
    const [confirmOpen, setConfirmOpen] = useState(false)

    return (
        <>
            <SharedInboxSurface {...props} items={items} keepOpen={keepOpen || confirmOpen} onMarkAllRead={() => setConfirmOpen(true)} />
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={t('title')}
                description={t('description', { count: items.length })}
                confirmLabel={t('confirm')}
                confirmVariant="default"
                onConfirm={onMarkAllRead}
            />
        </>
    )
}

function InboxPeek({ peek, anchor, onClose, onBack, onOpenConversation }: { peek: Peek; anchor: 'bottom' | 'top'; onClose: () => void; onBack: () => void; onOpenConversation: () => void }) {
    const { peek: state, answer, decide } = useInboxPeek(peek.target)
    return <InboxPeekCard entry={peek.entry} peek={state} anchor={anchor} onAnswer={answer} onDecide={decide} onClose={onClose} onBack={onBack} onOpenConversation={onOpenConversation} />
}
