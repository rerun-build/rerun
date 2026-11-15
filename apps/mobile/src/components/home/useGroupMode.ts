import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

export type GroupMode = 'recent' | 'box'

const GROUP_KEY = 'rerun.home-group'

let current: GroupMode = 'recent'
let loaded = false
const listeners = new Set<() => void>()

function publish(next: GroupMode) {
    current = next
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    if (!loaded) {
        loaded = true
        SecureStore.getItemAsync(GROUP_KEY)
            .then(stored => stored === 'box' && publish(stored))
            .catch(() => {})
    }
    return () => {
        listeners.delete(listener)
    }
}

export function useGroupMode(): [GroupMode, (mode: GroupMode) => void] {
    const mode = useSyncExternalStore(subscribe, () => current)

    const choose = (next: GroupMode) => {
        publish(next)
        SecureStore.setItemAsync(GROUP_KEY, next).catch(() => {})
    }

    return [mode, choose]
}
