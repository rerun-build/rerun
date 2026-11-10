import { formatDate } from '@rerun/i18n/format'

import type { CancelComeback } from '@/ee/lib/billing/cancel-flow'

export const CANCEL_STEPS = ['goodbye', 'sunk', 'reason', 'offer', 'farewell', 'done'] as const
export type CancelStep = (typeof CANCEL_STEPS)[number]

export type CancelOutcome = 'cancelled' | 'claimed' | 'reminded'

export const COMEBACK_OPTIONS: readonly CancelComeback[] = ['coming_back', 'maybe', 'not_coming_back']

export function shortDate(iso: string, locale: string): string {
    return formatDate(iso, locale, { month: 'short', day: 'numeric' })
}

export function daysBetween(fromIso: string, toIso: string): number {
    return Math.max(1, Math.ceil((Date.parse(toIso) - Date.parse(fromIso)) / (24 * 60 * 60_000)))
}
