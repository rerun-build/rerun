'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { PUBLISHED_PAGE_MARKER } from '@/lib/published/marker'

const subscribe = () => () => {}
const isAppPage = () => !document.querySelector(`[${PUBLISHED_PAGE_MARKER}], [data-quick-ask]`)
const onServer = () => false

export function AppChrome({ children }: { children: ReactNode }) {
    return useSyncExternalStore(subscribe, isAppPage, onServer) ? children : null
}
