'use client'

import './globals.css'
import { CrashScreen } from '@/components/layout/CrashScreen'
import { DEFAULT_LOCALE, matchLocale, type Locale } from '@moldwright/i18n'
import germanCommon from '@moldwright/i18n/messages/de/common.json'
import englishCommon from '@moldwright/i18n/messages/en/common.json'
import spanishCommon from '@moldwright/i18n/messages/es/common.json'
import frenchCommon from '@moldwright/i18n/messages/fr/common.json'
import portugueseCommon from '@moldwright/i18n/messages/pt/common.json'
import { NextIntlClientProvider } from 'next-intl'

const COMMON_PACKS: Record<Locale, Partial<typeof englishCommon>> = { en: englishCommon, fr: frenchCommon, es: spanishCommon, pt: portugueseCommon, de: germanCommon }

export default function GlobalError() {
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
