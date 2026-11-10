import type { Locale } from '@rerun/i18n'

import type { MobileMessages } from '@/i18n/messages'

declare module 'use-intl' {
    interface AppConfig {
        Locale: Locale
        Messages: MobileMessages
    }
}
