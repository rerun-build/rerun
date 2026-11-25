import { cloudMessages } from '@rerun/cloud/messages'
import type { AppLocale } from '@rerun/i18n'
import { loadMessages, type Messages } from '@rerun/i18n/messages'
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl'

// A whole pack filled with the name of a brand is the same for every push and notification of that
// brand in that language: built once and kept while the process lives. Past this many, an install
// with that many brands starts over.
const MAX_KEPT = 200
const kept = new Map<string, Promise<Messages>>()

function messagesFor(locale: AppLocale, brandName?: string): Promise<Messages> {
    const key = `${locale}\n${brandName ?? ''}`
    const known = kept.get(key)
    if (known) return known
    if (kept.size >= MAX_KEPT) kept.clear()
    const built = cloudMessages(locale).then(cloud => loadMessages(locale, [cloud], brandName))
    built.catch(() => kept.delete(key))
    kept.set(key, built)
    return built
}

// For text written outside a request (a push, an email, a job): the reader's language is not the
// request's, so next-intl's getTranslations cannot be used.
export async function translatorFor<Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(locale: AppLocale, namespace: Namespace, brandName?: string) {
    return createTranslator({ locale, messages: await messagesFor(locale, brandName), namespace })
}
