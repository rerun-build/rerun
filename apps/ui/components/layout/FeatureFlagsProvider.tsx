'use client'

import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { APP_SLUGS, type AppSlug } from '@rerun/cloud/apps'

export type FeatureFlags = { rewind: boolean; computer: boolean; published: boolean; i18n?: boolean; vault?: boolean; simpleView?: boolean; apps: Partial<Record<AppSlug, boolean>> }

// Tout à `false` par défaut : un composant rendu hors du provider, comme les menus de toolbar
// repris par le kit de marque, tombe du côté masqué sans avoir à le dire.
const FeatureFlagsContext = createContext<FeatureFlags>({ rewind: false, computer: false, published: false, apps: {} })

export function FeatureFlagsProvider({ rewind, computer, published, i18n = false, vault = false, simpleView = false, apps, children }: PropsWithChildren<FeatureFlags>) {
    const value = useMemo(() => ({ rewind, computer, published, i18n, vault, simpleView, apps }), [rewind, computer, published, i18n, vault, simpleView, apps])
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

export function useVaultEnabled() {
    return useContext(FeatureFlagsContext).vault ?? false
}

export function useSimpleViewEnabled() {
    return useContext(FeatureFlagsContext).simpleView ?? false
}

export function usePaidAppEnabled(slug: AppSlug) {
    return useContext(FeatureFlagsContext).apps[slug] ?? false
}

// The paid apps this workspace can see, in the order the menus list them. The layout hands a fresh
// `apps` object on every router refresh: the list keeps its identity as long as the same apps are
// on, since it sits in the deps of effects that call the server.
export function useEnabledPaidApps(): AppSlug[] {
    const { apps } = useContext(FeatureFlagsContext)
    const key = APP_SLUGS.filter(slug => apps[slug]).join(',')
    return useMemo(() => (key ? (key.split(',') as AppSlug[]) : []), [key])
}
