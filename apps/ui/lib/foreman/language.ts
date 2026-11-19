import { isStableLocale, languageName } from '@moldwright/i18n'

export function preferredLanguage(header: string | null | undefined): string | null {
    const tag = (header ?? '')
        .split(',')
        .map(part => part.trim().split(';')[0])
        .find(Boolean)
    if (!tag) return null

    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag.split('-')[0]) ?? null
    } catch {
        return null
    }
}

export function accountLanguage(locale: string | null | undefined): string | null {
    return isStableLocale(locale) ? languageName(locale) : null
}
