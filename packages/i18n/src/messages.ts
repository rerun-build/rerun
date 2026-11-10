import type englishMessages from '../messages/en/index'
import { DEFAULT_LOCALE, PSEUDO_LOCALE, type AppLocale, type Locale } from './locales'
import { mergeMessages, withoutContext, type MessageTree } from './merge'
import { pseudoMessages } from './pseudo'

export type Messages = typeof englishMessages

const PACKS: Record<Locale, () => Promise<{ default: MessageTree }>> = {
    en: () => import('../messages/en/index'),
    fr: () => import('../messages/fr/index'),
    es: () => import('../messages/es/index'),
}

// Every key of the English source, with the pack's strings over it and then the extra namespaces
// (Rerun Cloud's own strings), so a key missing anywhere still reads in English.
export async function loadMessages(locale: AppLocale, extra: MessageTree[] = []): Promise<Messages> {
    const english = withoutContext((await PACKS[DEFAULT_LOCALE]()).default) as Messages
    if (locale === PSEUDO_LOCALE) return pseudoMessages(mergeMessages(english, ...extra))
    if (locale === DEFAULT_LOCALE) return mergeMessages(english, ...extra)
    const pack = (await PACKS[locale]()).default
    return mergeMessages(english, pack, ...extra)
}
