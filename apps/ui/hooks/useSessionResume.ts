'use client'

import { openSessionAction } from '@/app/api/_actions/session.actions'
import type { SessionSnapshot } from '@/app/api/_services/conversation.service'
import type { UIMessage } from 'ai'
import { useEffect, useRef, type RefObject } from 'react'

type SessionResumeOptions = {
    sessionId: string | null | undefined
    enabled: boolean
    messages: UIMessage[]
    sendingRef: RefObject<boolean>
    onSnapshot: (snapshot: SessionSnapshot) => void
}

export function useSessionResume({ sessionId, enabled, messages, sendingRef, onSnapshot }: SessionResumeOptions) {
    const onSnapshotRef = useRef(onSnapshot)
    useEffect(() => {
        onSnapshotRef.current = onSnapshot
    }, [onSnapshot])

    useEffect(() => {
        if (!enabled || !sessionId) return
        let disposed = false
        let pending = false
        const visible = () => document.visibilityState !== 'hidden'

        const refresh = async () => {
            if (!visible() || pending || sendingRef.current) return
            pending = true
            try {
                const snapshot = await openSessionAction(sessionId)
                if (!disposed && !sendingRef.current && visible()) onSnapshotRef.current(snapshot)
            } catch {
                // Keep the current conversation if the network has not recovered yet.
            } finally {
                pending = false
            }
        }
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) void refresh()
        }

        document.addEventListener('visibilitychange', refresh)
        window.addEventListener('online', refresh)
        window.addEventListener('pageshow', onPageShow)
        return () => {
            disposed = true
            document.removeEventListener('visibilitychange', refresh)
            window.removeEventListener('online', refresh)
            window.removeEventListener('pageshow', onPageShow)
        }
        // A local send, stream, or transcript change invalidates an older snapshot in flight.
    }, [enabled, sessionId, messages, sendingRef])
}
