import { useEffect, useRef } from 'react'
import { BackHandler } from 'react-native'

// While `enabled`, Android's back gesture runs `onBack` instead of leaving the screen or the app. iOS has
// no such gesture: the hook does nothing there.
export function useSystemBack(enabled: boolean, onBack: () => void): void {
    const latest = useRef(onBack)
    useEffect(() => {
        latest.current = onBack
    })
    useEffect(() => {
        if (!enabled) return
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            latest.current()
            return true
        })
        return () => subscription.remove()
    }, [enabled])
}
