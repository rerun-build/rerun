import { cloudMessages } from '@rerun/cloud/messages'
import type { AppLocale } from '@rerun/i18n'
import { loadMessages, type Messages } from '@rerun/i18n/messages'
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl'

export async function translatorFor<Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(locale: AppLocale, namespace: Namespace) {
    const messages = await loadMessages(locale, [await cloudMessages(locale)])
    return createTranslator({ locale, messages, namespace })
}
