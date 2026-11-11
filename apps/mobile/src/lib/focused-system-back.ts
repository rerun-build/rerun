import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'

import { subscribeBack, useLatestBack } from '@/lib/system-back'

// `useSystemBack` for a screen that pushes routes over itself: the listener only lives while the screen
// is focused, so a sheet opened above it keeps the gesture for itself. Apart from `useSystemBack` so a
// component that only needs that one does not pull the router in.
export function useFocusedSystemBack(enabled: boolean, onBack: () => void): void {
    const latest = useLatestBack(onBack)
    useFocusEffect(
        useCallback(() => {
            if (!enabled) return
            return subscribeBack(latest)
        }, [enabled, latest])
    )
}
