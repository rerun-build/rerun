import { DEFAULT_LOCALE, matchLocale, type Locale } from '@rerun/i18n'

// Hermes ships Intl.Collator, DateTimeFormat and NumberFormat, not PluralRules, and every `{count,
// plural, ...}` message needs it. The packs' languages have cardinal rules that fit in a few lines
// (CLDR): this stands in for the platform until Hermes has its own.
type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

const MILLION = 1_000_000

function cardinal(locale: Locale, value: number): PluralCategory {
    const absolute = Math.abs(value)
    const integer = Number.isInteger(absolute)
    const largeRound = integer && absolute !== 0 && absolute % MILLION === 0
    if (locale === 'fr' || locale === 'pt') {
        if (Math.floor(absolute) === 0 || Math.floor(absolute) === 1) return 'one'
        return largeRound ? 'many' : 'other'
    }
    if (locale === 'es') {
        if (absolute === 1) return 'one'
        return largeRound ? 'many' : 'other'
    }
    return absolute === 1 && integer ? 'one' : 'other'
}

function ordinal(locale: Locale, value: number): PluralCategory {
    if (locale === 'fr') return value === 1 ? 'one' : 'other'
    if (locale !== 'en') return 'other'
    const tens = value % 100
    if (value % 10 === 1 && tens !== 11) return 'one'
    if (value % 10 === 2 && tens !== 12) return 'two'
    if (value % 10 === 3 && tens !== 13) return 'few'
    return 'other'
}

function firstLocale(locales: string | readonly string[] | undefined): Locale {
    const tags = typeof locales === 'string' ? [locales] : (locales ?? [])
    for (const tag of tags) {
        const locale = matchLocale(tag)
        if (locale) return locale
    }
    return DEFAULT_LOCALE
}

class PackPluralRules {
    private readonly locale: Locale
    private readonly type: 'cardinal' | 'ordinal'

    constructor(locales?: string | readonly string[], options?: { type?: 'cardinal' | 'ordinal' }) {
        this.locale = firstLocale(locales)
        this.type = options?.type ?? 'cardinal'
    }

    static supportedLocalesOf(locales: string | readonly string[]): string[] {
        return (typeof locales === 'string' ? [locales] : [...locales]).filter(tag => matchLocale(tag) !== null)
    }

    select(value: number): PluralCategory {
        return this.type === 'ordinal' ? ordinal(this.locale, value) : cardinal(this.locale, value)
    }

    resolvedOptions() {
        return { locale: this.locale, type: this.type, pluralCategories: ['one', 'many', 'other'] as PluralCategory[], minimumIntegerDigits: 1, minimumFractionDigits: 0, maximumFractionDigits: 3 }
    }
}

export function installPluralRules(target: { PluralRules?: unknown } = Intl as { PluralRules?: unknown }): void {
    if (typeof target.PluralRules === 'function') return
    Object.defineProperty(target, 'PluralRules', { value: PackPluralRules, configurable: true, writable: true })
}

export { PackPluralRules }
