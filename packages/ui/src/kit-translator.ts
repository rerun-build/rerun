import englishKit from '@moldwright/i18n/messages/en/kit.json'
import { createTranslator } from 'use-intl/core'

import type { useKitTranslations } from './locale'

export type KitTranslator = ReturnType<typeof useKitTranslations>

export const englishKitTranslator: KitTranslator = createTranslator({ locale: 'en', messages: { kit: englishKit }, namespace: 'kit' })
