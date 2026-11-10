import type { Messages } from '@rerun/i18n/messages'
import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl'

// The English pack as a translator, for a helper called where no reader is known (tests, logs, the
// admin, which stays in English).
export function englishTranslator<Namespace extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(namespace: Namespace) {
    return createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace })
}
