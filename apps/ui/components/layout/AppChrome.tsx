'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'

const subscribe = () => () => {}
// The desktop app's Quick ask window (`data-quick-ask`) is one field over another app, its coworker dock
// (`data-coworker-dock`) a rail on the edge of the screen: none of it either, nor the previews of a brand in its console
// (`data-organization-preview`).
const isAppPage = () => !document.querySelector(`[${PUBLISHED_PAGE_MARKER}], [data-quick-ask], [data-coworker-dock], [data-organization-preview]`)
const onServer = () => false

// What the app runs around every page (cookie banner, analytics, deploy watcher, service worker),
// kept off a published host: its gate and viewer pages render under the same root layout, on an
// origin that belongs to a coworker's page, where none of it has any business running.
export function AppChrome({ children }: { children: ReactNode }) {
    return useSyncExternalStore(subscribe, isAppPage, onServer) ? children : null
}
