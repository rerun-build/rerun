import { localeDirection, type Locale } from '@rerun/i18n'
import { reloadAppAsync } from 'expo'
import { getCalendars, useLocales } from 'expo-localization'
import { useEffect, useMemo, type ReactNode } from 'react'
import { I18nManager } from 'react-native'
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

// React Native lays a screen out right to left only from its next start: when the app's language
// changes direction, the choice is saved and the app restarts once. It waits for the account's language
// (read from the cache on a later start), so the phone's language alone never sets off a restart.
function useLayoutDirection(locale: Locale, settled: boolean) {
    const rightToLeft = localeDirection(locale) === 'rtl'
    useEffect(() => {
        if (!settled || I18nManager.isRTL === rightToLeft) return
        I18nManager.allowRTL(rightToLeft)
        I18nManager.forceRTL(rightToLeft)
        void reloadAppAsync('The app language changed its reading direction')
    }, [settled, rightToLeft])
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const { ready, session, me } = useAuth()
    const phoneLocales = useLocales()
    const phoneTags = phoneLocales.map(locale => locale.languageTag).join(',')
    const locale = appLocaleOf(accountLocale(me), phoneTags.split(','))
    const messages = useMemo(() => messagesFor(locale), [locale])
    const timeZone = getCalendars()[0]?.timeZone ?? undefined
    setCurrentLocale(locale)
    useLayoutDirection(locale, ready && (!session || me !== null))

    return (
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone} onError={reportIntlError}>
            {children}
        </IntlProvider>
    )
}
