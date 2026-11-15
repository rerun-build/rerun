'use client'

import { useEffect, useRef } from 'react'

import { listChangelogAction } from '@/app/api/_actions/changelog.actions'
import { useChangelogStore } from '@/stores/changelog.store'

const DAY_MS = 24 * 60 * 60 * 1000
const AUTO_OPEN_WINDOW_MS = 30 * DAY_MS

export function useChangelogLauncher(userId: string | undefined, ready: boolean) {
    const handledUser = useRef<string | null>(null)

    useEffect(() => {
        if (!userId || !ready || handledUser.current === userId) return
        handledUser.current = userId

        void listChangelogAction()
            .then(feed => {
                if (handledUser.current !== userId) return
                const store = useChangelogStore.getState()
                store.setFeed(feed)
                const fresh = feed.entries.some(entry => entry.unread && Date.now() - Date.parse(entry.publishedAt) < AUTO_OPEN_WINDOW_MS)
                if (fresh) store.openUnread()
            })
            .catch(() => undefined)
    }, [userId, ready])
}
