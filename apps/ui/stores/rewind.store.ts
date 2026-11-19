import type { RewindPayload } from '@moldwright/contracts'
import { create } from 'zustand'

import { markRewindViewedAction, readRewindAction, type RewindWeekEntry } from '@/app/api/_actions/rewind.actions'

type ShownRewind = { id: string | null; payload: RewindPayload }

type RewindState = {
    weeks: RewindWeekEntry[]
    payloads: Record<string, RewindPayload>
    shown: ShownRewind | null
    loadingWeek: string | null
    setWeeks: (weeks: RewindWeekEntry[]) => void
    openRewind: (rewind: ShownRewind) => void
    openWeek: (id: string) => Promise<void>
    openLatest: () => void
    closeRewind: () => void
}

export const useRewindStore = create<RewindState>((set, get) => ({
    weeks: [],
    payloads: {},
    shown: null,
    loadingWeek: null,
    setWeeks: weeks => set({ weeks, payloads: {} }),
    openRewind: rewind => set({ shown: rewind }),
    openWeek: async id => {
        set({ loadingWeek: id })
        const payload = get().payloads[id] ?? (await readRewindAction(id).catch(() => null))
        if (get().loadingWeek !== id) return
        if (!payload) {
            set({ loadingWeek: null })
            return
        }

        const week = get().weeks.find(entry => entry.id === id)
        set(state => ({
            loadingWeek: null,
            shown: { id, payload },
            payloads: { ...state.payloads, [id]: payload },
            weeks: state.weeks.map(entry => (entry.id === id ? { ...entry, viewed: true } : entry)),
        }))
        if (week && !week.viewed) void markRewindViewedAction(id).catch(() => undefined)
    },
    openLatest: () => {
        const latest = get().weeks[0]
        if (latest) void get().openWeek(latest.id)
    },
    closeRewind: () => set({ shown: null, loadingWeek: null }),
}))

export const selectHasUnseenLatest = (state: RewindState) => state.weeks.length > 0 && !state.weeks[0].viewed
