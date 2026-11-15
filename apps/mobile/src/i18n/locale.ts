import type { Me } from '@rerun/contracts'
import { resolveLocale, type Locale } from '@rerun/i18n'

export function accountLocale(me: Me | null): string | null {
    const user = me?.user as { locale?: unknown } | undefined
    return typeof user?.locale === 'string' ? user.locale : null
}

export function appLocaleOf(account: string | null, phoneLanguageTags: readonly string[]): Locale {
    return resolveLocale({ userLocale: account, acceptLanguage: phoneLanguageTags.join(',') })
}
