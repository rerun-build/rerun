'use client'

import type { AppLocale } from '@rerun/i18n'
import type { Messages } from '@rerun/i18n/messages'
import englishKit from '@rerun/i18n/messages/en/kit.json'
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
    return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>
}

export function useUiLocale(): AppLocale {
    return useContext(UiLocaleContext).locale
}

export function useKitTranslations() {
    const { locale, messages } = useContext(UiLocaleContext)
    return useMemo(() => createTranslator({ locale, messages, namespace: 'kit' }), [locale, messages])
}
