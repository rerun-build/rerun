import { formatDate } from '@rerun/i18n/format'
import { Cron } from 'croner'
import cronstrue from 'cronstrue'
import 'cronstrue/locales/es'
import 'cronstrue/locales/fr'

import type { EngineSchedule } from '@/lib/engine/types'

type ScheduleTiming = Pick<EngineSchedule, 'enabled' | 'cron' | 'runAt' | 'timezone' | 'lastRunAt'>

// The `agent` namespace, as far as a routine's timing reads it.
export type ScheduleCopy = (key: `schedule.${'once' | 'onceOn' | 'everyMinutes' | 'everyDay' | 'weekdays' | 'everyWeekday' | 'monthly'}`, values?: Record<string, string>) => string

// Only the packs' languages are loaded: cronstrue/i18n would ship its 30 others to the browser.
const CRONSTRUE_LOCALES = new Set(['fr', 'es'])

export function humanCron(cron: string, locale = 'en'): string | null {
    try {
        return cronstrue.toString(cron, { throwExceptionOnParseError: true, verbose: false, locale: CRONSTRUE_LOCALES.has(locale) ? locale : 'en' })
    } catch {
        return null
    }
}

export function scheduleSummary(schedule: Pick<EngineSchedule, 'cron' | 'runAt' | 'timezone'>, t: ScheduleCopy, locale?: string): string {
    if (schedule.cron) {
        const human = humanCron(schedule.cron, locale)
        return `${human ?? schedule.cron}${schedule.timezone ? ` · ${schedule.timezone}` : ''}`
    }
    if (schedule.runAt) return t('schedule.once', { date: formatDate(schedule.runAt, locale) })
    return '—'
}

function clockTime(hour: number, minute: number, locale?: string): string {
    return formatDate(new Date(2026, 0, 1, hour, minute), locale, { hour: 'numeric', minute: '2-digit' })
}

function clockTimes(hours: string, minute: number, locale?: string): string | null {
    const list = hours.split(',').map(hour => (/^\d+$/.test(hour) ? Number(hour) : NaN))
    if (list.some(hour => Number.isNaN(hour) || hour > 23)) return null
    return list.map(hour => clockTime(hour, minute, locale)).join(', ')
}

// 2024-01-07 is a Sunday, the cron's day 0.
function weekdayName(day: number, locale?: string): string {
    return formatDate(Date.UTC(2024, 0, 7 + day), locale, { weekday: 'long', timeZone: 'UTC' })
}

// "Every day at 8:15 AM" where cronstrue says "At 08:15 AM": covers the shapes coworkers write and
// falls back to cronstrue for the rest. Times are the cron's own, read in the routine's timezone.
export function routineFrequency(schedule: Pick<EngineSchedule, 'cron' | 'runAt'>, t: ScheduleCopy, locale?: string): string {
    if (schedule.runAt) return t('schedule.onceOn', { date: formatDate(schedule.runAt, locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
    if (!schedule.cron) return ''
    const fields = schedule.cron.trim().split(/\s+/)
    if (fields.length !== 5) return humanCron(schedule.cron, locale) ?? schedule.cron
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
    const everyMinutes = minute.match(/^\*\/(\d+)$/)
    if (everyMinutes && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') return t('schedule.everyMinutes', { count: everyMinutes[1] })
    const time = /^\d+$/.test(minute) && Number(minute) < 60 ? clockTimes(hour, Number(minute), locale) : null
    if (time && month === '*') {
        if (dayOfMonth === '*' && dayOfWeek === '*') return t('schedule.everyDay', { time })
        if (dayOfMonth === '*' && dayOfWeek === '1-5') return t('schedule.weekdays', { time })
        if (dayOfMonth === '*' && /^[0-6]$/.test(dayOfWeek)) return t('schedule.everyWeekday', { day: weekdayName(Number(dayOfWeek), locale), time })
        if (/^\d+$/.test(dayOfMonth) && dayOfWeek === '*') return t('schedule.monthly', { day: dayOfMonth, time })
    }
    return humanCron(schedule.cron, locale) ?? schedule.cron
}

// Mirrors nextRunAt in apps/engine/src/schedules/cron.ts: the engine never sends it over HTTP.
export function nextRunAt(schedule: ScheduleTiming, now: Date): string | null {
    if (!schedule.enabled) return null
    if (schedule.runAt) return schedule.lastRunAt ? null : schedule.runAt
    if (!schedule.cron) return null
    try {
        const next = new Cron(schedule.cron, schedule.timezone ? { timezone: schedule.timezone } : undefined).nextRun(now)
        return next ? next.toISOString() : null
    } catch {
        return null
    }
}
