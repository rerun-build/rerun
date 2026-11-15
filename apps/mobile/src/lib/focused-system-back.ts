import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'

import { subscribeBack, useLatestBack } from '@/lib/system-back'

export function useFocusedSystemBack(enabled: boolean, onBack: () => void): void {
    const latest = useLatestBack(onBack)
    useFocusEffect(
        useCallback(() => {
            if (!enabled) return
            return subscribeBack(latest)
        }, [enabled, latest])
    )
}
