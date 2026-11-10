import { coworkerRuleOf, mergeNotificationPrefs, type CoworkerRule, type NotificationPrefs, type NotificationPrefsPatch } from '@rerun/contracts'
import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { Alert } from 'react-native'

import { fetchNotificationPrefs, patchNotificationPrefs } from '@/api/notifications'
import { useAuth } from '@/auth/AuthProvider'
import { cachedNotificationPrefs } from '@/data/local-cache'
import { translatorFor } from '@/i18n/translator'

type Caller = { accessToken: string; workspaceId: number }
type Store = { userId: string | null; prefs: NotificationPrefs | null; failed: boolean }

// One copy for every screen that shows a rule (the settings, a coworker's page, an inbox row), so a
// change made on one is already there when the next opens.
let store: Store = { userId: null, prefs: null, failed: false }
const listeners = new Set<() => void>()
// Writes go out one after the other, and the hub's answer is only taken once none is left on its way:
// an earlier answer would put back what a later tap just changed. A read that left before a write
// is dropped the same way, even if it lands after the write answered.
let queue: Promise<unknown> = Promise.resolve()
let pending = 0
let writes = 0

function set(next: Partial<Store>) {
    store = { ...store, ...next }
    listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function ownStore(userId: string) {
    if (store.userId !== userId) set({ userId, prefs: cachedNotificationPrefs(userId).read(), failed: false })
}

async function reload(userId: string, caller: Caller) {
    ownStore(userId)
    const writesBefore = writes
    try {
        const prefs = await fetchNotificationPrefs(caller)
        if (store.userId !== userId || pending > 0 || writes !== writesBefore) return
        cachedNotificationPrefs(userId).save(prefs)
        set({ prefs, failed: false })
    } catch {
        if (store.userId === userId) set({ failed: true })
    }
}

function update(userId: string, caller: Caller, patch: NotificationPrefsPatch) {
    if (store.userId !== userId || !store.prefs) return
    set({ prefs: mergeNotificationPrefs(store.prefs, patch) })
    pending += 1
    writes += 1
    queue = queue
        .then(() => patchNotificationPrefs(caller, patch))
        .then(
            prefs => {
                pending -= 1
                if (pending > 0 || store.userId !== userId) return
                cachedNotificationPrefs(userId).save(prefs)
                set({ prefs })
            },
            err => {
                pending -= 1
                const t = translatorFor('mobileSettings')
                Alert.alert(t('notifications.saveFailed'), err instanceof Error && err.message ? err.message : t('notifications.tryAgainShortly'))
                if (pending === 0) reload(userId, caller)
            }
        )
}

export function useNotificationPrefs() {
    const { session, me } = useAuth()
    const userId = me?.user.id
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const caller = useMemo(() => (accessToken && workspaceId ? { accessToken, workspaceId } : null), [accessToken, workspaceId])
    const snapshot = useSyncExternalStore(subscribe, () => store)
    const mine = userId !== undefined && snapshot.userId === userId
    const prefs = mine ? snapshot.prefs : userId ? cachedNotificationPrefs(userId).read() : null

    useFocusEffect(
        useCallback(() => {
            if (userId && caller) reload(userId, caller)
        }, [userId, caller])
    )

    const patch = useCallback(
        (next: NotificationPrefsPatch) => {
            if (userId && caller) update(userId, caller, next)
        },
        [userId, caller]
    )

    const setCoworkerRule = useCallback((agentId: string, rule: CoworkerRule) => patch({ coworkers: { [agentId]: rule } }), [patch])

    return {
        prefs,
        failed: mine && snapshot.failed && !prefs,
        update: patch,
        setCoworkerRule,
        ruleOf: (agentId: string) => (prefs ? coworkerRuleOf(prefs, agentId) : null),
    }
}
