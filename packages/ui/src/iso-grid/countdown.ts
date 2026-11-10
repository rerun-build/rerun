import { englishKitTranslator, type KitTranslator } from '../kit-translator'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const SOON_MS = 15 * MINUTE

export function countdownShort(remainingMs: number, t: KitTranslator = englishKitTranslator): string {
    if (remainingMs < MINUTE) return t('isoGrid.countdown.seconds', { count: Math.max(1, Math.ceil(remainingMs / SECOND)) })
    if (remainingMs < HOUR) return t('isoGrid.countdown.minutes', { count: Math.round(remainingMs / MINUTE) })
    if (remainingMs < DAY) return t('isoGrid.countdown.hours', { count: Math.round(remainingMs / HOUR) })
    return t('isoGrid.countdown.days', { count: Math.round(remainingMs / DAY) })
}

// Past 99 the exact count no longer reads at a glance and only widens the pill.
export const resultsCount = (count: number) => (count > 99 ? '99+' : String(count))

export function isCountdownSoon(remainingMs: number): boolean {
    return remainingMs < SOON_MS
}
