import type { AppLocale } from '@moldwright/i18n'
import type { Messages } from '@moldwright/i18n/messages'

declare module 'next-intl' {
    interface AppConfig {
        Locale: AppLocale
        Messages: Messages
    }
}
