'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'

const subscribe = () => () => {}
const isAppPage = () => !document.querySelector(`[${PUBLISHED_PAGE_MARKER}]`)
const onServer = () => false

// What the app runs around every page (cookie banner, analytics, deploy watcher, service worker),
// kept off a published host: its gate and viewer pages render under the same root layout, on an
// origin that belongs to a coworker's page, where none of it has any business running.
export function AppChrome({ children }: { children: ReactNode }) {
    return useSyncExternalStore(subscribe, isAppPage, onServer) ? children : null
}
