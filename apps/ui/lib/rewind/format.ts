import { REWIND_HOURS_PER_WEEK } from '@rerun/contracts'
import { formatDayRange, weekdayNames } from '@rerun/i18n/format'

export { formatDuration } from '@rerun/i18n/format'

const HOUR_MS = 60 * 60 * 1000
const WORKDAY_HOURS = 8
const OFFICE_START = 9
const OFFICE_END = 18

export function formatWorked(ms: number): { value: number; unit: 'hours' | 'minutes' } {
    return ms >= HOUR_MS ? { value: Math.round(ms / HOUR_MS), unit: 'hours' } : { value: Math.max(1, Math.round(ms / 60_000)), unit: 'minutes' }
}

export function humanWorkdays(ms: number): number {
    return Math.round((ms / HOUR_MS / WORKDAY_HOURS) * 10) / 10
}

export function formatWeekRange(weekStart: string, weekEnd: string, locale?: string): string {
    return formatDayRange(new Date(weekStart), new Date(Date.parse(weekEnd) - 1), locale)
}

// The payload counts runs per UTC hour. Shifted by the viewer's offset, index 0 is Monday 00:00
// where they are. The few runs pushed past either end of the week are dropped.
export function localHourly(hourly: number[], utcOffsetMinutes: number): number[] {
    const shift = Math.round(utcOffsetMinutes / 60)
    return Array.from({ length: REWIND_HOURS_PER_WEEK }, (_, hour) => hourly[hour - shift] ?? 0)
}

export function dailyTotals(hourly: number[], locale?: string): { label: string; runs: number }[] {
    return weekdayNames(locale).map((label, day) => ({ label, runs: hourly.slice(day * 24, day * 24 + 24).reduce((a, b) => a + b, 0) }))
}

export function outOfOfficeShare(hourly: number[]): number {
    const total = hourly.reduce((a, b) => a + b, 0)
    if (total === 0) return 0
    const inOffice = hourly.reduce((sum, runs, hour) => {
        const day = Math.floor(hour / 24)
        const clock = hour % 24
        return day < 5 && clock >= OFFICE_START && clock < OFFICE_END ? sum + runs : sum
    }, 0)
    return Math.round(((total - inOffice) / total) * 100)
}

export function percentChange(current: number, previous: number): number | null {
    if (previous <= 0) return null
    return Math.round(((current - previous) / previous) * 100)
}

export function rawToolLabel(name: string): string {
    const words = name.replace(/[_-]+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
}
