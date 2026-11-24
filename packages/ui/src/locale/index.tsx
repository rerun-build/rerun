'use client'

import { localeDirection, type AppLocale, type TextDirection } from '@rerun/i18n'
import type { Messages } from '@rerun/i18n/messages'
import englishKit from '@rerun/i18n/messages/en/kit.json'
import { Direction } from 'radix-ui'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createTranslator } from 'use-intl'

export { englishKitTranslator, type KitTranslator } from '../kit-translator'

type KitMessages = Pick<Messages, 'kit'>

// The language the shared components speak and format in, and their strings (the `kit` namespace).
// The landing renders them without a provider and gets English; the app hands down its request locale
// and its pack from the root layout. packages/ui never imports next-intl.
const UiLocaleContext = createContext<{ locale: AppLocale; messages: KitMessages }>({ locale: 'en', messages: { kit: englishKit } })

export function UiLocaleProvider({ locale, messages, children }: { locale: AppLocale; messages?: KitMessages; children: ReactNode }) {
    const value = useMemo(() => ({ locale, messages: messages ?? { kit: englishKit } }), [locale, messages])
    return (
        <UiLocaleContext.Provider value={value}>
            <Direction.Provider dir={localeDirection(locale)}>{children}</Direction.Provider>
        </UiLocaleContext.Provider>
    )
}

// The reading direction of the interface, for what CSS cannot flip on its own: a slide, a drag, a
// scroll offset.
export function useUiDirection(): TextDirection {
    return localeDirection(useContext(UiLocaleContext).locale)
}

export function useUiLocale(): AppLocale {
    return useContext(UiLocaleContext).locale
}

export function useKitTranslations() {
    const { locale, messages } = useContext(UiLocaleContext)
    return useMemo(() => createTranslator({ locale, messages, namespace: 'kit' }), [locale, messages])
}
