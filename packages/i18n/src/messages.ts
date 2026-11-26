import type englishMessages from '../messages/en/index'
import { DEFAULT_BRAND_NAME, fillBrand } from './brand'
import { DEFAULT_LOCALE, PSEUDO_LOCALE, type AppLocale, type Locale } from './locales'
import { mergeMessages, withoutContext, type MessageTree } from './merge'
import { pseudoMessages } from './pseudo'

export type Messages = typeof englishMessages

const PACKS: Record<Locale, () => Promise<{ default: MessageTree }>> = {
    en: () => import('../messages/en/index'),
    fr: () => import('../messages/fr/index'),
    es: () => import('../messages/es/index'),
    pt: () => import('../messages/pt/index'),
    de: () => import('../messages/de/index'),
    tr: () => import('../messages/tr/index'),
    ar: () => import('../messages/ar/index'),
    zh: () => import('../messages/zh/index'),
    'zh-TW': () => import('../messages/zh-TW/index'),
    he: () => import('../messages/he/index'),
}

// Every key of the English source, with the pack's strings over it and then the extra namespaces
// (Rerun Cloud's own strings), so a key missing anywhere still reads in English. `brandName` is what
// the product calls itself in them.
export async function loadMessages(locale: AppLocale, extra: MessageTree[] = [], brandName: string = DEFAULT_BRAND_NAME): Promise<Messages> {
    const english = withoutContext((await PACKS[DEFAULT_LOCALE]()).default) as Messages
    if (locale === PSEUDO_LOCALE) return pseudoMessages(fillBrand(mergeMessages(english, ...extra), brandName))
    if (locale === DEFAULT_LOCALE) return fillBrand(mergeMessages(english, ...extra), brandName)
    const pack = (await PACKS[locale]()).default
    return fillBrand(mergeMessages(english, pack, ...extra), brandName)
}
