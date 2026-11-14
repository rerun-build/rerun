'use client'

import { create } from 'zustand'

import type { AppSlug } from './apps'

export function AppsMenuSection(_props: { apps: AppSlug[]; onOpen: (slug: AppSlug) => void }) {
    return null
}

export function PaidAppDialogs(_props: { apps: AppSlug[] }) {
    return null
}

export function AppAccountPicker(_props: { slug: AppSlug; title: string; agentId: string; onAuthorized: () => void }) {
    return null
}

type PaidAppsState = {
    revision: number
    accountCounts: Partial<Record<AppSlug, number>>
    openApp: (slug: AppSlug, reconnectId?: string) => void
    refreshAccountCount: (slug: AppSlug) => Promise<void>
}

export const usePaidAppsStore = create<PaidAppsState>(() => ({
    revision: 0,
    accountCounts: {},
    openApp: () => {},
    refreshAccountCount: async () => {},
}))
