import { DEFAULT_LOCALE, PSEUDO_LOCALE } from './locales'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

// The English output predates the packs: short dates read day first (en-GB) and long ones the US
// way. Kept as they were, so turning the packs on changes nothing for an English reader.
function tag(locale: string, english: 'en-GB' | 'en-US'): string {
    return locale === DEFAULT_LOCALE || locale === PSEUDO_LOCALE ? english : locale
}

function isEnglish(locale: string): boolean {
    return locale === DEFAULT_LOCALE || locale === PSEUDO_LOCALE
}

function capitalize(text: string, locale: string): string {
    return text.charAt(0).toLocaleUpperCase(tag(locale, 'en-US')) + text.slice(1)
}

function narrowUnit(value: number, unit: 'minute' | 'hour' | 'day', locale: string): string {
    if (isEnglish(locale)) return `${value}${unit.charAt(0)}`
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)
}

function rightNow(locale: string): string {
    return new Intl.RelativeTimeFormat(tag(locale, 'en-US'), { numeric: 'auto' }).format(0, 'second')
}

function dayMonth(date: Date, locale: string, now: Date): string {
    const sameYear = date.getFullYear() === now.getFullYear()
    return date.toLocaleDateString(tag(locale, 'en-GB'), { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: '2-digit' }) })
}

/** "now", "5m", "3h", "2d", then a short date: how long ago, in as few characters as possible. */
export function shortRelativeTime(iso: string, locale: string = DEFAULT_LOCALE, now: Date = new Date()): string {
    const date = new Date(iso)
    const diff = now.getTime() - date.getTime()

    if (diff < MINUTE) return rightNow(locale)
    if (diff < HOUR) return narrowUnit(Math.floor(diff / MINUTE), 'minute', locale)
    if (diff < DAY) return narrowUnit(Math.floor(diff / HOUR), 'hour', locale)
    if (diff < WEEK) return narrowUnit(Math.floor(diff / DAY), 'day', locale)
    return dayMonth(date, locale, now)
}

/** "now", "in 5m", "in 3h", then a short date: how long until. */
export function shortUntil(iso: string, locale: string = DEFAULT_LOCALE, now: Date = new Date()): string {
    const date = new Date(iso)
    const diff = date.getTime() - now.getTime()

    if (diff < MINUTE) return rightNow(locale)
    if (diff >= WEEK) return dayMonth(date, locale, now)
    const [value, unit] = diff < HOUR ? [Math.floor(diff / MINUTE), 'minute' as const] : diff < DAY ? [Math.floor(diff / HOUR), 'hour' as const] : [Math.floor(diff / DAY), 'day' as const]
    if (isEnglish(locale)) return `in ${narrowUnit(value, unit, locale)}`
    return new Intl.RelativeTimeFormat(locale, { style: 'short' }).format(value, unit)
}

export function fullDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
    return new Date(iso).toLocaleString(tag(locale, 'en-GB'), { dateStyle: 'medium', timeStyle: 'short' })
}

const clocks = new Map<string, Intl.DateTimeFormat>()

// The 12 or 24 hour clock is the browser's, whatever the language of the words.
function clock(locale: string): Intl.DateTimeFormat {
    let format = clocks.get(locale)
    if (!format) {
        format = new Intl.DateTimeFormat(tag(locale, 'en-US'), { hour: 'numeric', minute: '2-digit', hourCycle: new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle })
        clocks.set(locale, format)
    }
    return format
}

export function messageTime(iso: string, locale: string = DEFAULT_LOCALE): string {
    return clock(locale).format(new Date(iso))
}

export function calendarDaysBetween(earlier: Date, later: Date): number {
    const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    return Math.round((startOf(later) - startOf(earlier)) / DAY)
}

/** "Today", "Yesterday", a weekday within the week, a date beyond. */
export function messageDayLabel(iso: string, locale: string = DEFAULT_LOCALE, now: Date = new Date()): string {
    const date = new Date(iso)
    const daysAgo = calendarDaysBetween(date, now)
    const language = tag(locale, 'en-US')
    if (daysAgo <= 1) return capitalize(new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-Math.max(0, daysAgo), 'day'), locale)
    if (daysAgo < 7) return capitalize(date.toLocaleDateString(language, { weekday: 'long' }), locale)
    const sameYear = date.getFullYear() === now.getFullYear()
    return date.toLocaleDateString(language, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "Mar 5" */
export function shortDate(date: Date | string, locale: string = DEFAULT_LOCALE): string {
    return new Date(date).toLocaleDateString(tag(locale, 'en-US'), { month: 'short', day: 'numeric' })
}

/** "12 March": the day of a deadline, in UTC, as an email states it. */
export function dayAndMonth(date: Date | string, locale: string = DEFAULT_LOCALE): string {
    return new Date(date).toLocaleDateString(tag(locale, 'en-GB'), { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** "16:00": a time of day in UTC, on the 24-hour clock whatever the reader's. */
export function utcClockTime(date: Date | string, locale: string = DEFAULT_LOCALE): string {
    return new Date(date).toLocaleTimeString(tag(locale, 'en-GB'), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

/** "Mar 5, 2026" */
export function longDate(date: Date | string, locale: string = DEFAULT_LOCALE): string {
    return new Date(date).toLocaleDateString(tag(locale, 'en-US'), { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatNumber(value: number, locale: string = DEFAULT_LOCALE, options?: Intl.NumberFormatOptions): string {
    return value.toLocaleString(tag(locale, 'en-US'), options)
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

export function formatBytes(bytes: number, locale: string = DEFAULT_LOCALE): string {
    if (isEnglish(locale)) {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    }
    const power = Math.min(BYTE_UNITS.length - 1, bytes < 1024 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)))
    const value = bytes / 1024 ** power
    return new Intl.NumberFormat(locale, { style: 'unit', unit: BYTE_UNITS[power], unitDisplay: 'short', minimumFractionDigits: power ? 1 : 0, maximumFractionDigits: power ? 1 : 0 }).format(value)
}

/** "45s", "12 min", "2h 5m": how long something took. */
export function formatDuration(ms: number, locale: string = DEFAULT_LOCALE): string {
    const minutes = Math.round(ms / MINUTE)
    if (isEnglish(locale)) {
        if (minutes < 1) return `${Math.max(1, Math.round(ms / SECOND))}s`
        if (minutes < 60) return `${minutes} min`
        const hours = Math.floor(minutes / 60)
        const rest = minutes % 60
        return rest ? `${hours}h ${rest}m` : `${hours}h`
    }
    const unit = (value: number, name: 'second' | 'minute' | 'hour', display: 'narrow' | 'short') => new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: display }).format(value)
    if (minutes < 1) return unit(Math.max(1, Math.round(ms / SECOND)), 'second', 'narrow')
    if (minutes < 60) return unit(minutes, 'minute', 'short')
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${unit(hours, 'hour', 'narrow')} ${unit(rest, 'minute', 'narrow')}` : unit(hours, 'hour', 'narrow')
}

/** Any date with its own options: the English reading keeps the US form it always had. */
export function formatDate(date: Date | string | number, locale: string = DEFAULT_LOCALE, options?: Intl.DateTimeFormatOptions): string {
    return new Date(date).toLocaleString(tag(locale, 'en-US'), options)
}
