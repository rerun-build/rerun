export type LocaleStatus = 'stable' | 'beta'

export const SUPPORTED_LOCALES = {
    en: 'stable',
    fr: 'stable',
    es: 'stable',
    pt: 'stable',
    de: 'stable',
} as const satisfies Record<string, LocaleStatus>

export type Locale = keyof typeof SUPPORTED_LOCALES

export const LOCALES = Object.keys(SUPPORTED_LOCALES) as Locale[]

export const DEFAULT_LOCALE: Locale = 'en'

export const PSEUDO_LOCALE = 'en-XA'

export type AppLocale = Locale | typeof PSEUDO_LOCALE

export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

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

export function resolveLocale({ userLocale, cookie, acceptLanguage }: { userLocale?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
    const chosen = matchLocale(userLocale) ?? matchLocale(cookie)
    if (chosen) return chosen
    return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE
}

export function localeNativeName(locale: Locale): string {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

export function languageName(locale: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale
    } catch {
        return locale
    }
}
