import { mergeMessages, matchLocale, DEFAULT_LOCALE, type Locale, type MessageTree } from '@rerun/i18n'
import english from '@rerun/i18n/messages/en/desktopApp.json'

const packs = import.meta.glob<{ default: MessageTree }>('../../../../packages/i18n/messages/*/desktopApp.json', { eager: true })

export type DesktopAppMessages = Omit<typeof english, '_context'>

export function desktopAppMessages(locale: Locale): DesktopAppMessages {
    const pack = Object.entries(packs).find(([path]) => path.endsWith(`/${locale}/desktopApp.json`))?.[1].default
    return mergeMessages({}, english as MessageTree, pack) as DesktopAppMessages
}

export function resolveShellLocale(...candidates: (string | null | undefined)[]): Locale {
    for (const candidate of candidates) {
        const locale = matchLocale(candidate)
        if (locale) return locale
    }
    return DEFAULT_LOCALE
}
