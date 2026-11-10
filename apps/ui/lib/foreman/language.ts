import { isStableLocale, languageName } from '@rerun/i18n'

// The foreman answers in the user's language, and the first turn happens before anyone has typed
// enough for the model to tell. The browser already says it in Accept-Language, so that is the
// opening guess; once the conversation has started, what the user actually writes wins, and the
// settled value is stored on the profile rather than re-guessed on every turn.
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

// The language the account picked for the app, named as the prompt names it ("French"), or null
// while it follows the browser.
export function accountLanguage(locale: string | null | undefined): string | null {
    return isStableLocale(locale) ? languageName(locale) : null
}
