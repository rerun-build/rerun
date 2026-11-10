'use client'

import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { localeNativeName, parseAcceptLanguage, PSEUDO_LOCALE, stableLocales, DEFAULT_LOCALE, type Locale } from '@rerun/i18n'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const AUTOMATIC = 'auto'
export const SHOW_PSEUDO = process.env.NODE_ENV !== 'production'

export type LanguageChoice = Locale | typeof PSEUDO_LOCALE | null

export type LanguagePanelProps = {
    value: LanguageChoice
    onChange: (choice: LanguageChoice) => Promise<void>
}

function browserLocale(): Locale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE
    return parseAcceptLanguage(navigator.languages.join(',')) ?? DEFAULT_LOCALE
}

export function LanguagePanel({ value, onChange }: LanguagePanelProps) {
    const t = useTranslations('account.language')
    const [pending, setPending] = useState<LanguageChoice | undefined>(undefined)
    const shown = pending === undefined ? value : pending

    const pick = async (next: string) => {
        const choice = next === AUTOMATIC ? null : (next as LanguageChoice)
        setPending(choice)
        try {
            await onChange(choice)
        } finally {
            setPending(undefined)
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
            <Field label={t('field')} htmlFor="account-language" helperText={shown === null ? t('automaticHint', { language: localeNativeName(browserLocale()) }) : undefined}>
                <Select value={shown ?? AUTOMATIC} onValueChange={pick} disabled={pending !== undefined}>
                    <SelectTrigger id="account-language" className="w-full sm:w-72">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                        <SelectItem value={AUTOMATIC}>{t('automatic')}</SelectItem>
                        {stableLocales().map(locale => (
                            <SelectItem key={locale} value={locale} lang={locale}>
                                {localeNativeName(locale)}
                            </SelectItem>
                        ))}
                        {SHOW_PSEUDO && <SelectItem value={PSEUDO_LOCALE}>Pseudo ({PSEUDO_LOCALE})</SelectItem>}
                    </SelectContent>
                </Select>
            </Field>
        </div>
    )
}
