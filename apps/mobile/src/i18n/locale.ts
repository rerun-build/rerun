import type { Me } from '@rerun/contracts'
import { resolveLocale, type Locale } from '@rerun/i18n'

// `users.locale` as `/api/v1/me` returns it, once the hub sends it and the contract keeps it: until
// then the field is absent and the phone's language decides alone. `null` means "follow the device".
export function accountLocale(me: Me | null): string | null {
    const user = me?.user as { locale?: unknown } | undefined
    return typeof user?.locale === 'string' ? user.locale : null
}

// The account's choice first, then the languages of the phone in its order (iOS puts the app's own
// language from Settings first), then English.
export function appLocaleOf(account: string | null, phoneLanguageTags: readonly string[]): Locale {
    return resolveLocale({ userLocale: account, acceptLanguage: phoneLanguageTags.join(',') })
}
