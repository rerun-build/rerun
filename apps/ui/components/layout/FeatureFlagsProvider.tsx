'use client'

import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { APP_SLUGS, type AppSlug } from '@rerun/cloud/apps'

export type FeatureFlags = { apps: Partial<Record<AppSlug, boolean>> }

// No paid app by default: a component rendered outside the provider, like the toolbar menus the brand
// kit reuses, falls on the hidden side without having to say so.
const FeatureFlagsContext = createContext<FeatureFlags>({ apps: {} })

export function FeatureFlagsProvider({ apps, children }: PropsWithChildren<FeatureFlags>) {
    const value = useMemo(() => ({ apps }), [apps])
    return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
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
