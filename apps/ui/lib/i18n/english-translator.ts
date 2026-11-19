import type { Messages } from '@moldwright/i18n/messages'
import { ENGLISH_MESSAGES } from '@moldwright/i18n/messages/en'
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl'

export function englishTranslator<Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(namespace: Namespace) {
    return createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace })
}
