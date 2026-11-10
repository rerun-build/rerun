import { calendarDaysBetween, formatDate } from '@rerun/i18n/format'
import { getCalendars } from 'expo-localization'
import { useLocale, useTranslations } from 'use-intl'

const clocks = new Map<string, Intl.DateTimeFormat>()

// The words follow the app's language, the 12 or 24 hour clock is the phone's.
function clock(locale: string): Intl.DateTimeFormat {
    let format = clocks.get(locale)
    if (!format) {
        format = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, { hour: 'numeric', minute: '2-digit', hour12: !getCalendars()[0]?.uses24hourClock })
        clocks.set(locale, format)
    }
    return format
}

export function messageTime(iso: string, locale: string): string {
    return clock(locale).format(new Date(iso))
}

export type RelativeDayWords = { today: string; yesterday: string }

// Hermes has no Intl.RelativeTimeFormat: "Today" and "Yesterday" come from the pack, the rest from the
// date formatter it does have.
export function messageDayLabel(iso: string, locale: string, words: RelativeDayWords, now: Date = new Date()): string {
    const date = new Date(iso)
    const daysAgo = calendarDaysBetween(date, now)
    if (daysAgo <= 0) return words.today
    if (daysAgo === 1) return words.yesterday
    if (daysAgo < 7) return capitalized(formatDate(date, locale, { weekday: 'long' }), locale)
    const sameYear = date.getFullYear() === now.getFullYear()
    return formatDate(date, locale, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

function capitalized(text: string, locale: string): string {
    return text.charAt(0).toLocaleUpperCase(locale === 'en' ? 'en-US' : locale) + text.slice(1)
}

export function messageStamp(iso: string, locale: string, words: RelativeDayWords): string {
    return `${messageDayLabel(iso, locale, words)} ${messageTime(iso, locale)}`
}

export function useMessageTimes() {
    const locale = useLocale()
    const t = useTranslations('mobileCommon.time')
    const words = { today: t('today'), yesterday: t('yesterday') }
    return {
        time: (iso: string) => messageTime(iso, locale),
        day: (iso: string) => messageDayLabel(iso, locale, words),
        stamp: (iso: string) => messageStamp(iso, locale, words),
    }
}

// "now", "5m", "3h", "2d": how long ago, in as few characters as possible.
export function useTimeAgo(): (minutes: number) => string {
    const t = useTranslations('mobileCommon.time')
    return minutes => {
        if (minutes < 1) return t('now')
        if (minutes < 60) return t('minutesAgo', { count: minutes })
        if (minutes < 60 * 24) return t('hoursAgo', { count: Math.floor(minutes / 60) })
        return t('daysAgo', { count: Math.floor(minutes / (60 * 24)) })
    }
}
