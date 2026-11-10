import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

export type GroupMode = 'recent' | 'box'

const GROUP_KEY = 'rerun.home-group'

// Shared by the Home and the Preferences sheet above it: a choice made in the sheet regroups the Home
// underneath before the sheet closes.
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

// How the Home lists the coworkers, kept on the device from one launch to the next.
export function useGroupMode(): [GroupMode, (mode: GroupMode) => void] {
    const mode = useSyncExternalStore(subscribe, () => current)

    const choose = (next: GroupMode) => {
        publish(next)
        SecureStore.setItemAsync(GROUP_KEY, next).catch(() => {})
    }

    return [mode, choose]
}
