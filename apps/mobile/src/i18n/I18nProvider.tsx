import { getCalendars, useLocales } from 'expo-localization'
import { useMemo, type ReactNode } from 'react'
import { IntlProvider, type IntlError } from 'use-intl'

import { useAuth } from '@/auth/AuthProvider'
import { accountLocale, appLocaleOf } from '@/i18n/locale'
import { messagesFor } from '@/i18n/messages'
import { installPluralRules } from '@/i18n/plural-rules'
import { setCurrentLocale } from '@/i18n/translator'

installPluralRules()

function reportIntlError(error: IntlError) {
    if (__DEV__) console.warn(`[i18n] ${error.message}`)
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const { me } = useAuth()
    const phoneLocales = useLocales()
    const phoneTags = phoneLocales.map(locale => locale.languageTag).join(',')
    const locale = appLocaleOf(accountLocale(me), phoneTags.split(','))
    const messages = useMemo(() => messagesFor(locale), [locale])
    const timeZone = getCalendars()[0]?.timeZone ?? undefined
    setCurrentLocale(locale)

    return (
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone} onError={reportIntlError}>
            {children}
        </IntlProvider>
    )
}
