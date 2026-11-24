import type { InboxItem } from '@rerun/contracts'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { fetchInbox, markInboxRead } from '@/api/inbox'
import { useAuth } from '@/auth/AuthProvider'
import { inboxCount } from '@/components/inbox/inbox'
import { cachedInbox } from '@/data/local-cache'
import { useBurstReload, useLiveReload } from '@/data/useLiveReload'
import { setBadge } from '@/notifications/push'

// `fresh`: read from the hub since the app opened, not the copy the phone kept from the last visit.
type InboxState = { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: InboxItem[]; running: number; fresh: boolean }

type Inbox = InboxState & {
    markRead: (items: InboxItem[]) => void
    clearAll: () => void
    reload: () => void
}

const InboxContext = createContext<Inbox | null>(null)

// The web's inbox, read once for the home's bell and its sheet, again whenever a session, a
// notification or a read changes in Realtime, and when the app comes back to the foreground.
export function InboxProvider({ children }: { children: ReactNode }) {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const userId = session?.user.id
    const workspaceId = me?.workspace.id
    const [read, setRead] = useState<{ workspaceId: number; inbox: InboxState } | null>(null)
    // Row id → the first read that may show it again: one started after the write landed. A read
    // already on its way when the row was marked would otherwise bring it back.
    const [hidden, setHidden] = useState<Record<string, number>>({})
    const [version, setVersion] = useState(0)
    const latestVersion = useRef(0)

    const reload = useCallback(() => {
        latestVersion.current += 1
        setVersion(latestVersion.current)
    }, [])
    const reloadSoon = useBurstReload(reload)

    useEffect(() => {
        if (!accessToken || !workspaceId) return
        let cancelled = false
        cachedInbox(workspaceId)
            .load(() => fetchInbox({ accessToken, workspaceId }))
            .then(inbox => {
                if (cancelled) return
                setRead({ workspaceId, inbox: { state: 'ready', ...inbox, fresh: true } })
                setHidden(current => Object.fromEntries(Object.entries(current).filter(([, until]) => until > version)))
            })
            .catch(() => {
                if (cancelled) return
                const kept = cachedInbox(workspaceId).read()
                setRead(current => (current?.workspaceId === workspaceId && current.inbox.state === 'ready' ? current : { workspaceId, inbox: kept ? { state: 'ready', ...kept, fresh: false } : { state: 'error' } }))
            })
        return () => {
            cancelled = true
        }
    }, [accessToken, workspaceId, version])

    useLiveReload(
        workspaceId && userId ? `inbox:${workspaceId}:${userId}` : null,
        (channel, changed) => {
            channel
                .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, changed)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `workspace_id=eq.${workspaceId}` }, changed)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'session_reads', filter: `user_id=eq.${userId}` }, changed)
        },
        reloadSoon
    )

    const write = useCallback(
        (sessionIds: string[] | 'all', rowIds: string[]) => {
            if (!accessToken || !workspaceId) return
            const hide = (until: number) => setHidden(current => ({ ...current, ...Object.fromEntries(rowIds.map(id => [id, until])) }))
            hide(Number.POSITIVE_INFINITY)
            // The write's own echo (its session_reads rows) comes back through Realtime within the
            // burst: the two make one read.
            markInboxRead({ accessToken, workspaceId }, sessionIds)
                .then(() => hide(latestVersion.current + 1))
                .catch(() => setHidden(current => Object.fromEntries(Object.entries(current).filter(([id]) => !rowIds.includes(id)))))
                .finally(reloadSoon)
        },
        [accessToken, workspaceId, reloadSoon]
    )

    const shown = useMemo<InboxState>(() => {
        const kept = workspaceId && read?.workspaceId !== workspaceId ? cachedInbox(workspaceId).read() : null
        const inbox: InboxState = read && read.workspaceId === workspaceId ? read.inbox : kept ? { state: 'ready', ...kept, fresh: false } : { state: 'loading' }
        return inbox.state === 'ready' ? { ...inbox, items: inbox.items.filter(item => !(item.id in hidden)) } : inbox
    }, [read, workspaceId, hidden])

    const markRead = useCallback((items: InboxItem[]) => write(items.flatMap(item => item.sessionIds), items.map(item => item.id)), [write])
    const clearAll = useCallback(() => write('all', shown.state === 'ready' ? shown.items.map(item => item.id) : []), [write, shown])

    // The app icon shows the bell's count, never off the copy kept from the last visit, whatever screen
    // is up: the Home rests frozen under a conversation.
    const unread = shown.state === 'ready' && shown.fresh ? inboxCount(shown.items) : null
    useEffect(() => {
        if (unread !== null) setBadge(unread).catch(() => {})
    }, [unread])

    return <InboxContext value={{ ...shown, markRead, clearAll, reload }}>{children}</InboxContext>
}

export function useInbox(): Inbox {
    const inbox = use(InboxContext)
    if (!inbox) throw new Error('useInbox outside InboxProvider')
    return inbox
}
