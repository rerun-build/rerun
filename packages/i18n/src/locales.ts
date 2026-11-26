// `stable` locales are offered in the language pickers, `beta` ones only resolve for whoever already
// has them set. A new pack starts in `beta` and moves to `stable` once it has been seen in the app.
export type LocaleStatus = 'stable' | 'beta'

export const SUPPORTED_LOCALES = {
    en: 'stable',
    fr: 'stable',
    es: 'stable',
    pt: 'stable',
    de: 'stable',
    tr: 'stable',
    ar: 'stable',
    zh: 'stable',
    'zh-TW': 'stable',
    he: 'stable',
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

export type TextDirection = 'ltr' | 'rtl'

const RIGHT_TO_LEFT_LOCALES: readonly string[] = ['ar', 'he']

export function localeDirection(locale: string): TextDirection {
    return RIGHT_TO_LEFT_LOCALES.includes(locale) ? 'rtl' : 'ltr'
}

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && Object.hasOwn(SUPPORTED_LOCALES, value)
}

export function isStableLocale(value: unknown): value is Locale {
    return isLocale(value) && SUPPORTED_LOCALES[value] === 'stable'
}

export function stableLocales(): Locale[] {
    return LOCALES.filter(locale => SUPPORTED_LOCALES[locale] === 'stable')
}

// Older Android and Java systems still report Hebrew under its withdrawn code.
const LEGACY_LANGUAGE_CODES: Record<string, Locale> = { iw: 'he' }

const TRADITIONAL_CHINESE_REGIONS = ['tw', 'hk', 'mo']

// Chinese is the one language with two packs, told apart by its script: "zh-Hant" or a region that
// writes Traditional characters (Taiwan, Hong Kong, Macau) reads the Taiwan pack, any other "zh" the
// Simplified one.
function chinesePack(subtags: string[]): Locale {
    if (subtags.includes('hant')) return 'zh-TW'
    if (subtags.includes('hans')) return 'zh'
    return subtags.some(subtag => TRADITIONAL_CHINESE_REGIONS.includes(subtag)) ? 'zh-TW' : 'zh'
}

// "fr-CA" and "FR" both land on "fr": the packs are per language, never per region, except Chinese.
export function matchLocale(tag: string | null | undefined): Locale | null {
    if (!tag) return null
    const [first, ...subtags] = tag.trim().toLowerCase().split(/[-_]/)
    if (!first) return null
    const language = LEGACY_LANGUAGE_CODES[first] ?? first
    if (language === 'zh') return chinesePack(subtags)
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

// The two Chinese packs are named by their script, so they read apart in a list.
const CHINESE_NATIVE_NAMES: Partial<Record<Locale, string>> = { zh: '简体中文', 'zh-TW': '繁體中文 (台灣)' }

// Each language is shown in its own words ("Français", "Español"), so whoever cannot read the
// current one still finds theirs.
export function localeNativeName(locale: Locale): string {
    const chinese = CHINESE_NATIVE_NAMES[locale]
    if (chinese) return chinese
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

// The language as the prompts of a model name it ("French"), whatever the language of the reader.
// Chinese is named with its script, so a model answers in the characters of the pack.
export function languageName(locale: string): string {
    if (locale === 'zh-TW') return 'Traditional Chinese (Taiwan)'
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale === 'zh' ? 'zh-Hans' : locale) ?? locale
    } catch {
        return locale
    }
}
