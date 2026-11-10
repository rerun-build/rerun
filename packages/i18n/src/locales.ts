// `stable` locales are offered in the language pickers, `beta` ones only resolve for whoever already
// has them set. A new pack starts in `beta` and moves to `stable` once it has been seen in the app.
export type LocaleStatus = 'stable' | 'beta'

export const SUPPORTED_LOCALES = {
    en: 'stable',
    fr: 'stable',
    es: 'stable',
} as const satisfies Record<string, LocaleStatus>

export type Locale = keyof typeof SUPPORTED_LOCALES

export const LOCALES = Object.keys(SUPPORTED_LOCALES) as Locale[]

export const DEFAULT_LOCALE: Locale = 'en'

// Development only: every string accented and stretched, to spot a hard-coded string or a layout
// that breaks under a longer language.
export const PSEUDO_LOCALE = 'en-XA'

export type AppLocale = Locale | typeof PSEUDO_LOCALE

// Shared by the app and the landing (set on `.rerun.build`), so a visitor who picks a language on the
// landing signs up in it.
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

// What a `users.locale` or `workspaces.locale` column accepts, mirrored by their check constraint.
export const LOCALE_TAG_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && Object.hasOwn(SUPPORTED_LOCALES, value)
}

export function isStableLocale(value: unknown): value is Locale {
    return isLocale(value) && SUPPORTED_LOCALES[value] === 'stable'
}

export function stableLocales(): Locale[] {
    return LOCALES.filter(locale => SUPPORTED_LOCALES[locale] === 'stable')
}

// "fr-CA" and "FR" both land on "fr": the packs are per language, never per region.
export function matchLocale(tag: string | null | undefined): Locale | null {
    if (!tag) return null
    const language = tag.trim().split(/[-_]/)[0]?.toLowerCase()
    return isLocale(language) ? language : null
}

export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
    if (!header) return null
    const ranked = header
        .split(',')
        .map((part, index) => {
            const [tag, ...params] = part.trim().split(';')
            const q = params.map(param => param.trim()).find(param => param.startsWith('q='))
            return { tag, quality: q ? Number(q.slice(2)) : 1, index }
        })
        .filter(entry => entry.tag && entry.tag !== '*' && Number.isFinite(entry.quality) && entry.quality > 0)
        .sort((a, b) => b.quality - a.quality || a.index - b.index)
    for (const { tag } of ranked) {
        const locale = matchLocale(tag)
        if (locale && isStableLocale(locale)) return locale
    }
    return null
}

// The order is the account's choice, then the cookie (the choice of a visitor without an account, or
// the account's choice mirrored on this device), then the browser. A `null` account locale means
// "follow the browser".
export function resolveLocale({ userLocale, cookie, acceptLanguage }: { userLocale?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
    const chosen = matchLocale(userLocale) ?? matchLocale(cookie)
    if (chosen) return chosen
    return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE
}

// Each language is shown in its own words ("Français", "Español"), so whoever cannot read the
// current one still finds theirs.
export function localeNativeName(locale: Locale): string {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

// The language as the prompts of a model name it ("French"), whatever the language of the reader.
export function languageName(locale: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale
    } catch {
        return locale
    }
}
