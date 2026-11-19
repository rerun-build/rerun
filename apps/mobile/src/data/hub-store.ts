import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

// One copy of each thing the hub said, shared by every screen that reads it. Three pages of the same
// coworker ask for its skills once; a screen opened again within `freshFor` asks for nothing; coming
// back to the foreground reads again what the screens on show hold, once each. A screen that already
// reads its rows again on return (`useLiveReload`) says `foreground: false`, so they are read once.

// Where a value lives between launches: an entry of `local-cache`, or nowhere.
export type Persisted<T> = { read: () => T | null; save: (value: T) => void }

// `fresh`: the hub answered since the app opened. `failed`: its last read failed, the value (when
// there is one) is the copy the phone kept.
export type HubState<T> = { value: T | null; fresh: boolean; failed: boolean }

// `again`: a read asked for while another was on its way, which may predate what it was asked to catch.
type Slot<T> = { state: HubState<T>; listeners: Set<() => void>; loading: Promise<T> | null; again: Promise<T> | null; readAt: number; persisted?: Persisted<T> }

export const FRESH_FOR_MS = 30_000

const EMPTY: HubState<never> = { value: null, fresh: false, failed: false }
const slots = new Map<string, Slot<unknown>>()
const wakers = new Map<string, Set<() => void>>()
// Moves on at each sign-out: an answer still on its way from before is dropped.
let generation = 0

function slotOf<T>(key: string, persisted?: Persisted<T>): Slot<T> {
    let slot = slots.get(key) as Slot<T> | undefined
    if (!slot) {
        slot = { state: { value: persisted?.read() ?? null, fresh: false, failed: false }, listeners: new Set(), loading: null, again: null, readAt: 0, persisted }
        slots.set(key, slot as Slot<unknown>)
    }
    return slot
}

function publish<T>(slot: Slot<T>, state: HubState<T>) {
    slot.state = state
    slot.listeners.forEach(listener => listener())
}

// Asks the hub, unless the same question is already on its way. An answer equal to what is held keeps
// the object held, so nothing that shows it is drawn again. With `again` (a change was just made or
// heard), a read already on its way is followed by one more, once, whoever else asks meanwhile.
// `persisted` is only read for a key asked for the first time.
export function loadHub<T>(key: string, fetch: () => Promise<T>, persisted?: Persisted<T>, { again = false }: { again?: boolean } = {}): Promise<T> {
    const slot = slotOf(key, persisted)
    if (slot.loading && again) {
        slot.again ??= slot.loading
            .catch(() => undefined)
            .then(() => {
                slot.again = null
                return loadHub(key, fetch)
            })
        return slot.again
    }
    if (slot.loading) return slot.loading
    const askedFor = generation
    const loading = fetch()
        .then(value => {
            if (askedFor !== generation) return value
            slot.readAt = Date.now()
            const held = slot.state.value
            const same = held !== null && JSON.stringify(held) === JSON.stringify(value)
            if (!same) slot.persisted?.save(value)
            if (!same || !slot.state.fresh || slot.state.failed) publish(slot, { value: same ? held : value, fresh: true, failed: false })
            return same ? held : value
        })
        .catch((error: unknown) => {
            if (askedFor === generation) publish(slot, { ...slot.state, failed: true })
            throw error
        })
        .finally(() => {
            if (slot.loading === loading) slot.loading = null
        })
    slot.loading = loading
    return loading
}

let foreground: { remove: () => void } | null = null

function wakeOnForeground(key: string, wake: () => void): () => void {
    const keyWakers = wakers.get(key) ?? new Set()
    keyWakers.add(wake)
    wakers.set(key, keyWakers)
    foreground ??= AppState.addEventListener('change', state => {
        if (state !== 'active') return
        for (const woken of wakers.values()) woken.values().next().value?.()
    })
    return () => {
        keyWakers.delete(wake)
        if (keyWakers.size === 0) wakers.delete(key)
    }
}

// Nothing the hub said stays in memory once the person signs out.
export function forgetHub() {
    generation += 1
    slots.clear()
    foreground?.remove()
    foreground = null
}

type HubOptions<T> = { persisted?: Persisted<T>; freshFor?: number; foreground?: boolean }

// What the hub said for `key`, read when the screen opens unless it is fresh, and again when the app
// comes back to the foreground unless `foreground` is false. Null `key`: nothing to read yet.
// `answeredHere`: the hub answered since this screen opened, not only earlier in the launch.
export function useHub<T>(key: string | null, fetch: () => Promise<T>, { persisted, freshFor = FRESH_FOR_MS, foreground: wakes = true }: HubOptions<T> = {}): HubState<T> & { answeredHere: boolean; reload: () => Promise<T | null> } {
    // The latest `fetch` drawn for each key: a read put off (one more after the read on its way, a
    // burst timer) still asks for its own key once the screen has moved on to another.
    const asks = useRef(new Map<string, () => Promise<T>>())
    useLayoutEffect(() => {
        if (key) asks.current.set(key, fetch)
    })
    const ask = useCallback(() => asks.current.get(key ?? '')!(), [key])
    const [answeredFor, setAnsweredFor] = useState<string | null>(null)
    const subscribe = useCallback(
        (listener: () => void) => {
            if (!key) return () => {}
            const { listeners } = slotOf(key, persisted)
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        // `persisted` only matters when the slot is first made, for the key it names.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [key]
    )
    const state = useSyncExternalStore(subscribe, () => (key ? (slotOf(key, persisted).state as HubState<T>) : EMPTY))

    useEffect(() => {
        if (!key) return
        const slot = slotOf(key, persisted)
        let alive = true
        const answered = () => alive && setAnsweredFor(key)
        if (Date.now() - slot.readAt > freshFor) loadHub(key, ask).then(answered, () => {})
        const stopWaking = wakes ? wakeOnForeground(key, () => void loadHub(key, ask).catch(() => {})) : undefined
        return () => {
            alive = false
            stopWaking?.()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, freshFor, ask, wakes])

    const reload = useCallback(() => (key ? loadHub(key, ask, undefined, { again: true }).catch(() => null) : Promise.resolve(null)), [key, ask])
    return { ...state, answeredHere: answeredFor === key, reload }
}
