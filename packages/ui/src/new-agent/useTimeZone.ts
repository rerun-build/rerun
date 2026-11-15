'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

export function useTimeZone(): string | null {
    return useSyncExternalStore(
        subscribe,
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        () => null
    )
}

export function timeZoneOffset(timeZone: string): string | null {
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value ?? null
    } catch {
        return null
    }
}
