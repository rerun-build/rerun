'use client'

import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { APP_SLUGS, type AppSlug } from '@rerun/cloud/apps'

export type FeatureFlags = { rewind: boolean; computer: boolean; published: boolean; i18n?: boolean; apps: Partial<Record<AppSlug, boolean>> }

const FeatureFlagsContext = createContext<FeatureFlags>({ rewind: false, computer: false, published: false, apps: {} })

export function FeatureFlagsProvider({ rewind, computer, published, i18n = false, apps, children }: PropsWithChildren<FeatureFlags>) {
    const value = useMemo(() => ({ rewind, computer, published, i18n, apps }), [rewind, computer, published, i18n, apps])
    return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
}

export function useRewindEnabled() {
    return useContext(FeatureFlagsContext).rewind
}

export function useComputerEnabled() {
    return useContext(FeatureFlagsContext).computer
}

export function usePublishedAccessEnabled() {
    return useContext(FeatureFlagsContext).published
}

export function useLanguagePacksEnabled() {
    return useContext(FeatureFlagsContext).i18n ?? false
}

export function usePaidAppEnabled(slug: AppSlug) {
    return useContext(FeatureFlagsContext).apps[slug] ?? false
}

export function useEnabledPaidApps(): AppSlug[] {
    const { apps } = useContext(FeatureFlagsContext)
    const key = APP_SLUGS.filter(slug => apps[slug]).join(',')
    return useMemo(() => (key ? (key.split(',') as AppSlug[]) : []), [key])
}
