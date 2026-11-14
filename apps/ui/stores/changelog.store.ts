import { create } from 'zustand'

import { markChangelogSeenAction, type ChangelogEntryView, type ChangelogFeed } from '@/app/api/_actions/changelog.actions'

const MAX_AUTO = 3

type ChangelogState = {
    entries: ChangelogEntryView[]
    seenAt: string | null
    shown: ChangelogEntryView[]
    open: boolean
    setFeed: (feed: ChangelogFeed) => void
    openUnread: () => void
    openAll: () => void
    close: () => void
}

export const useChangelogStore = create<ChangelogState>((set, get) => ({
    entries: [],
    seenAt: null,
    shown: [],
    open: false,
    setFeed: feed => set({ entries: feed.entries, seenAt: feed.seenAt }),
    openUnread: () => {
        const unread = get().entries.filter(entry => entry.unread).slice(0, MAX_AUTO).reverse()
        if (unread.length) set({ shown: unread, open: true })
    },
    openAll: () => {
        const all = get().entries
        if (all.length) set({ shown: all, open: true })
    },
    close: () => {
        const { shown, seenAt } = get()
        set({ open: false })
        const newest = shown.reduce<ChangelogEntryView | undefined>(
            (latest, entry) => (!latest || Date.parse(entry.publishedAt) > Date.parse(latest.publishedAt) ? entry : latest),
            undefined,
        )
        if (!newest) return
        if (seenAt && Date.parse(newest.publishedAt) <= Date.parse(seenAt)) return

        set(state => ({
            seenAt: newest.publishedAt,
            entries: state.entries.map(entry => (Date.parse(entry.publishedAt) <= Date.parse(newest.publishedAt) ? { ...entry, unread: false } : entry)),
        }))
        void markChangelogSeenAction(newest.publishedAt).catch(() => undefined)
    },
}))

export const selectUnreadCount = (state: ChangelogState) => state.entries.filter(entry => entry.unread).length
export const selectHasEntries = (state: ChangelogState) => state.entries.length > 0
