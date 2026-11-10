'use client'

import './globals.css'
import { CrashScreen } from '@/components/layout/CrashScreen'
import { DEFAULT_LOCALE, matchLocale, type Locale } from '@rerun/i18n'
import englishCommon from '@rerun/i18n/messages/en/common.json'
import spanishCommon from '@rerun/i18n/messages/es/common.json'
import frenchCommon from '@rerun/i18n/messages/fr/common.json'
import { NextIntlClientProvider } from 'next-intl'

// This replaces the root layout and its intl provider, so the crash screen brings its own small pack,
// in the language the page was showing (the `lang` the root layout wrote on <html>).
const COMMON_PACKS: Record<Locale, Partial<typeof englishCommon>> = { en: englishCommon, fr: frenchCommon, es: spanishCommon }

export default function GlobalError() {
    // This replaces the root layout, so the theme class next-themes put on <html> would be dropped.
    const htmlClassName = typeof document === 'undefined' ? 'h-full antialiased' : document.documentElement.className
    const locale = (typeof document === 'undefined' ? null : matchLocale(document.documentElement.lang)) ?? DEFAULT_LOCALE

    return (
        <html lang={locale} className={htmlClassName} suppressHydrationWarning>
            <body className="min-h-full flex flex-col font-sans">
                <NextIntlClientProvider locale={locale} messages={{ common: { ...englishCommon, ...COMMON_PACKS[locale] } }}>
                    <CrashScreen />
                </NextIntlClientProvider>
            </body>
        </html>
    )
}
