import { emailTranslator } from '@moldwright/emails/i18n'
import { DEFAULT_LOCALE, type Locale } from '@moldwright/i18n'
import { dayAndMonth, utcClockTime } from '@moldwright/i18n/format'

export function emailDateLabel(value: Date, locale: Locale = DEFAULT_LOCALE): string {
    return dayAndMonth(value, locale)
}

export function emailTimeLabel(value: Date, locale: Locale = DEFAULT_LOCALE): string {
    return emailTranslator(locale)('common.dateAtTime', { date: dayAndMonth(value, locale), time: utcClockTime(value, locale) })
}
