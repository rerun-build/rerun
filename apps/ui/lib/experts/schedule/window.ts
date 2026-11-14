export type LocalWindow = {
    startHour: number
    endHour: number
    weekdays: readonly number[]
}

export type LocalParts = {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    weekday: number
}

export const DEFAULT_WINDOW: LocalWindow = { startHour: 8, endHour: 18, weekdays: [1, 2, 3, 4, 5] }

export const MINUTE_MS = 60_000
export const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatters.get(timeZone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
        formatters.set(timeZone, formatter)
    }
    return formatter
}

export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone })
        return true
    } catch {
        return false
    }
}

export function getLocalParts(date: Date, timeZone: string): LocalParts {
    const parts = formatterFor(timeZone).formatToParts(date)
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
    const year = value('year')
    const month = value('month')
    const day = value('day')
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    return { year, month, day, hour: value('hour'), minute: value('minute'), weekday }
}

export function isInLocalWindow(date: Date, timeZone: string, window: LocalWindow): boolean {
    const parts = getLocalParts(date, timeZone)
    if (!window.weekdays.includes(parts.weekday)) return false
    const minutes = parts.hour * 60 + parts.minute
    return minutes >= window.startHour * 60 && minutes < window.endHour * 60
}

function offsetMsAt(date: Date, timeZone: string): number {
    const parts = getLocalParts(date, timeZone)
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS
}

export function zonedWallTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
    const target = Date.UTC(year, month - 1, day, hour, minute)
    let guess = new Date(target - offsetMsAt(new Date(target), timeZone))
    guess = new Date(target - offsetMsAt(guess, timeZone))

    const back = getLocalParts(guess, timeZone)
    const backMs = Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute)
    return backMs < target ? new Date(guess.getTime() + (target - backMs)) : guess
}

export function nextEligibleAt(from: Date, timeZone: string, window: LocalWindow): Date | null {
    if (window.weekdays.length === 0 || window.startHour >= window.endHour) return null
    if (isInLocalWindow(from, timeZone, window)) return from

    for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
        const parts = getLocalParts(new Date(from.getTime() + dayOffset * DAY_MS), timeZone)
        if (!window.weekdays.includes(parts.weekday)) continue

        const candidate = zonedWallTimeToInstant(parts.year, parts.month, parts.day, window.startHour, 0, timeZone)
        if (candidate.getTime() < from.getTime()) continue
        if (isInLocalWindow(candidate, timeZone, window)) return candidate
    }
    return null
}

export function localWindowCloseAt(date: Date, timeZone: string, window: LocalWindow): Date | null {
    if (!isInLocalWindow(date, timeZone, window)) return null
    const parts = getLocalParts(date, timeZone)
    return zonedWallTimeToInstant(parts.year, parts.month, parts.day, window.endHour, 0, timeZone)
}

export function capDayKey(date: Date, capTimeZone: string): string {
    const { year, month, day } = getLocalParts(date, capTimeZone)
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function startOfNextCapDay(date: Date, capTimeZone: string): Date {
    const { year, month, day } = getLocalParts(date, capTimeZone)
    const nextDay = getLocalParts(new Date(zonedWallTimeToInstant(year, month, day, 12, 0, capTimeZone).getTime() + DAY_MS), capTimeZone)
    return zonedWallTimeToInstant(nextDay.year, nextDay.month, nextDay.day, 0, 0, capTimeZone)
}
