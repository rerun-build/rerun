import { create } from 'zustand'
import { getAppsOverviewAction } from '@/app/api/_actions/apps.actions'
import type { AppSlug } from '@/lib/apps/types'

type PaidAppsState = {
    openSlug: AppSlug | null
    reconnectId: string | null
    revision: number
    accountCounts: Partial<Record<AppSlug, number>>
    openApp: (slug: AppSlug, reconnectId?: string) => void
    closeApp: () => void
    bumpRevision: () => void
    refreshAccountCount: (slug: AppSlug) => Promise<void>
}

export const usePaidAppsStore = create<PaidAppsState>(set => ({
    openSlug: null,
    reconnectId: null,
    revision: 0,
    accountCounts: {},
    openApp: (slug, reconnectId) => set({ openSlug: slug, reconnectId: reconnectId ?? null }),
    closeApp: () => set({ openSlug: null, reconnectId: null }),
    bumpRevision: () => set(state => ({ revision: state.revision + 1 })),
    refreshAccountCount: async slug => {
        const result = await getAppsOverviewAction(slug)
        if (result.ok) set(state => ({ accountCounts: { ...state.accountCounts, [slug]: result.value.connections.filter(connection => connection.status !== 'connecting').length } }))
    },
}))
