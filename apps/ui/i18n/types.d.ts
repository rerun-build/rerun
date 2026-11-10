import type { AppLocale } from '@rerun/i18n'
import type { Messages } from '@rerun/i18n/messages'

declare module 'next-intl' {
    interface AppConfig {
        Locale: AppLocale
        Messages: Messages
    }
}
