import { useEffect, useRef, type RefObject } from 'react'
import { BackHandler } from 'react-native'

export function useLatestBack(onBack: () => void): RefObject<() => void> {
    const latest = useRef(onBack)
    useEffect(() => {
        latest.current = onBack
    })
    return latest
}

export function subscribeBack(latest: RefObject<() => void>): () => void {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        latest.current()
        return true
    })
    return () => subscription.remove()
}

// While `enabled`, Android's back gesture runs `onBack` instead of leaving the screen or the app. iOS has
// no such gesture: the hook does nothing there.
export function useSystemBack(enabled: boolean, onBack: () => void): void {
    const latest = useLatestBack(onBack)
    useEffect(() => {
        if (!enabled) return
        return subscribeBack(latest)
    }, [enabled, latest])
}
