import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'

// Where a link a coworker wrote opens: the phone's own browser, where the person is signed in to their
// services, or Rerun's browser, which keeps them in the app.
export type LinkTarget = 'browser' | 'app'

const LINK_TARGET_KEY = 'rerun.link-target'

let current: LinkTarget = 'browser'
let loading: Promise<LinkTarget> | null = null
const listeners = new Set<() => void>()

export function parseLinkTarget(stored: string | null): LinkTarget {
    return stored === 'app' ? 'app' : 'browser'
}

function publish(next: LinkTarget) {
    current = next
    listeners.forEach(listener => listener())
}

// Read once from the device, on the first link opened or the first look at the Preferences.
export function loadLinkTarget(): Promise<LinkTarget> {
    loading ??= SecureStore.getItemAsync(LINK_TARGET_KEY)
        .then(stored => {
            publish(parseLinkTarget(stored))
            return current
        })
        .catch(() => current)
    return loading
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    loadLinkTarget()
    return () => {
        listeners.delete(listener)
    }
}

export function useLinkTarget(): [LinkTarget, (target: LinkTarget) => void] {
    const target = useSyncExternalStore(subscribe, () => current)

    const choose = (next: LinkTarget) => {
        loading = Promise.resolve(next)
        publish(next)
        SecureStore.setItemAsync(LINK_TARGET_KEY, next).catch(() => {})
    }

    return [target, choose]
}
