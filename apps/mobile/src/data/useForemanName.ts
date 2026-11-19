import { FOREMAN_DISPLAY_NAME, type ForemanSurface } from '@rerun/contracts'
import { useFocusEffect } from 'expo-router'
import { useCallback, useSyncExternalStore } from 'react'

import { fetchForemanState } from '@/api/foreman'
import { useAuth } from '@/auth/AuthProvider'
import { cachedForeman } from '@/data/local-cache'

type Store = { workspaceId: number | null; name: string | null }

// One copy for every screen that names the Chief of Staff (the Home's row, its page, the search), so
// a name given on the web shows everywhere at once on the next read.
let store: Store = { workspaceId: null, name: null }
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

// Kept on the phone with what it knew of the Chief of Staff, for the next launch to open on it.
export function rememberForemanName(workspaceId: number, name: string | null, surface: ForemanSurface) {
    const kept = cachedForeman(workspaceId).read()
    cachedForeman(workspaceId).save({ surface, last: kept?.last ?? null, ...(name ? { name } : {}) })
    store = { workspaceId, name }
    listeners.forEach(listener => listener())
}

// What the workspace calls its Chief of Staff, null until someone gave it a name.
export function useForemanName(): string | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const snapshot = useSyncExternalStore(subscribe, () => store)

    useFocusEffect(
        useCallback(() => {
            if (!accessToken || !workspaceId) return
            fetchForemanState({ accessToken, workspaceId })
                .then(state => rememberForemanName(workspaceId, state.name ?? null, state.surface))
                .catch(() => {})
        }, [accessToken, workspaceId])
    )

    if (!workspaceId) return null
    return snapshot.workspaceId === workspaceId ? snapshot.name : (cachedForeman(workspaceId).read()?.name ?? null)
}

// The arguments of every message that names it: `named` picks the wording with its name.
export function foremanNameValues(name: string | null): { named: 'yes' | 'no'; name: string } {
    return { named: name ? 'yes' : 'no', name: name ?? '' }
}

export const foremanLabel = (name: string | null) => name ?? FOREMAN_DISPLAY_NAME

// The same arguments from the name a chat already shows for it (`foremanLabel`).
export const foremanLabelValues = (label: string) => foremanNameValues(label === FOREMAN_DISPLAY_NAME ? null : label)
