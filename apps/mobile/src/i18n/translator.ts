import { DEFAULT_LOCALE, type Locale } from '@rerun/i18n'
import { createTranslator } from 'use-intl'

import { messagesFor, type MobileMessages } from '@/i18n/messages'

let current: Locale = DEFAULT_LOCALE

export function setCurrentLocale(locale: Locale): void {
    current = locale
}

export function currentLocale(): Locale {
    return current
}

export function translatorFor<Namespace extends keyof MobileMessages>(namespace: Namespace) {
    return createTranslator({ locale: current, messages: messagesFor(current), namespace })
}
