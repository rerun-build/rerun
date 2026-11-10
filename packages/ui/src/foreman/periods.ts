import { formatDate } from '@rerun/i18n/format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type PeriodKey = 'running' | 'morning' | 'afternoon' | 'tonight' | 'tomorrow' | 'week' | 'later' | 'paused'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
    running: 'Running',
    morning: 'This morning',
    afternoon: 'This afternoon',
    tonight: 'Tonight',
    tomorrow: 'Tomorrow',
    week: 'This week',
    later: 'Later',
    paused: 'Paused',
}

type PeriodTiming = { nextRunAt: string | null; runningSince: string | null }

function startOfDay(at: number): number {
    return new Date(at).setHours(0, 0, 0, 0)
}

function clockOf(at: Date, locale: string): string {
    return formatDate(at, locale, { hour: 'numeric', minute: '2-digit' })
}

export function periodOf(routine: PeriodTiming, now: number): PeriodKey {
    if (routine.runningSince) return 'running'
    if (!routine.nextRunAt) return 'paused'
    const at = new Date(routine.nextRunAt)
    const days = Math.round((startOfDay(at.getTime()) - startOfDay(now)) / DAY)
    if (days <= 0) {
        if (at.getHours() < 12) return 'morning'
        if (at.getHours() < 18) return 'afternoon'
        return 'tonight'
    }
    if (days === 1) return 'tomorrow'
    if (days < 7) return 'week'
    return 'later'
}

export function groupByPeriod<T extends PeriodTiming>(routines: T[], now: number): { key: PeriodKey; routines: T[] }[] {
    const byPeriod = new Map<PeriodKey, T[]>()
    for (const routine of routines) {
        const key = periodOf(routine, now)
        byPeriod.set(key, [...(byPeriod.get(key) ?? []), routine])
    }
    return (Object.keys(PERIOD_LABELS) as PeriodKey[]).filter(key => byPeriod.has(key)).map(key => ({ key, routines: byPeriod.get(key) ?? [] }))
}

export function timeIn(period: PeriodKey, iso: string, locale: string): string {
    const at = new Date(iso)
    if (period === 'week') return `${formatDate(at, locale, { weekday: 'short' })} ${clockOf(at, locale)}`
    if (period === 'later') return formatDate(at, locale, { month: 'short', day: 'numeric' })
    return clockOf(at, locale)
}

export function isWithinTheHour(iso: string, now: number): boolean {
    return new Date(iso).getTime() - now < HOUR
}

export function shortCountdown(iso: string, now: number): string {
    const ms = new Date(iso).getTime() - now
    if (ms < MINUTE) return 'now'
    if (ms < HOUR) return `in ${Math.floor(ms / MINUTE)}m`
    return `in ${Math.floor(ms / HOUR)}h`
}

export function shortElapsed(iso: string, now: number): string {
    const ms = Math.max(0, now - new Date(iso).getTime())
    if (ms < MINUTE) return '<1m'
    if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
    return `${Math.floor(ms / HOUR)}h`
}
