import englishKit from '@rerun/i18n/messages/en/kit.json'
import { createTranslator } from 'use-intl/core'

import type { useKitTranslations } from './locale'

export type KitTranslator = ReturnType<typeof useKitTranslations>

// For a helper called outside React (a test, a default argument): it reads the English source.
export const englishKitTranslator: KitTranslator = createTranslator({ locale: 'en', messages: { kit: englishKit }, namespace: 'kit' })
