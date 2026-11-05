import { Cron } from 'croner'
import type { Schedule } from './loader.js'

function cronFor(schedule: Schedule): Cron {
    return new Cron(schedule.cron as string, schedule.timezone ? { timezone: schedule.timezone } : undefined)
}

export function isValidCron(expr: string): boolean {
    try {
        new Cron(expr)
        return true
    } catch {
        return false
    }
}

/**
 * Whether croner can run a schedule in `timezone`: an IANA name ('Europe/Paris') or an alias the
 * platform knows ('UTC'). croner takes any string when the schedule is built and only throws when
 * it computes a run, so this asks it for one.
 */
export function isValidTimezone(timezone: string): boolean {
    try {
        new Cron('* * * * *', { timezone }).nextRun()
        return true
    } catch {
        return false
    }
}

/**
 * The next run after `from`, or null when croner can't compute one: a timezone or cron edited into
 * the file by hand, or written before both were checked. Such a schedule never fires, and the
 * scheduler's tick goes on to the others instead of throwing.
 */
function nextCronRun(schedule: Schedule, from: Date): Date | null {
    try {
        return cronFor(schedule).nextRun(from)
    } catch {
        return null
    }
}

export function isDue(schedule: Schedule, now: Date): boolean {
    if (!schedule.enabled) return false
    if (schedule.runAt) {
        if (schedule.lastRunAt) return false
        return now.getTime() >= new Date(schedule.runAt).getTime()
    }
    if (!schedule.cron) return false
    const baseline = schedule.lastRunAt ?? schedule.createdAt
    const next = nextCronRun(schedule, baseline ? new Date(baseline) : now)
    return Boolean(next && next.getTime() <= now.getTime())
}

export function nextRunAt(schedule: Schedule, now: Date): string | null {
    if (!schedule.enabled) return null
    if (schedule.runAt) return schedule.lastRunAt ? null : schedule.runAt
    if (!schedule.cron) return null
    const next = nextCronRun(schedule, now)
    return next ? next.toISOString() : null
}
