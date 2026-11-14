'use client'

import { useCallback, useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 639.98px)'

function useSubscribe(query: string) {
    return useCallback(
        (onChange: () => void) => {
            const mql = window.matchMedia(query)
            mql.addEventListener('change', onChange)
            return () => mql.removeEventListener('change', onChange)
        },
        [query],
    )
}

export function useIsMobile(query = MOBILE_QUERY) {
    return useSyncExternalStore(useSubscribe(query), () => window.matchMedia(query).matches, () => false)
}

export function useResolvedIsMobile(query = MOBILE_QUERY) {
    return useSyncExternalStore<boolean | null>(useSubscribe(query), () => window.matchMedia(query).matches, () => null)
}
