import { DEFAULT_LOCALE, type MessageTree } from '@rerun/i18n'
import englishKit from '@rerun/i18n/messages/en/kit.json'
import { UiLocaleProvider } from '@rerun/ui/locale'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { IntlProvider } from 'use-intl'
import { desktopAppMessages, resolveShellLocale } from '../../shared/messages'
import { shellLocal } from './shell-local'
import './styles.css'

const kitPacks = import.meta.glob<{ default: MessageTree }>('../../../../../packages/i18n/messages/*/kit.json', { eager: true })

// The shell's pages follow the system's light or dark appearance, or the one a caller passes (the
// find bar matches the app it sits on).
function applyTheme(): void {
    const requested = new URLSearchParams(location.search).get('theme')
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', requested ? requested === 'dark' : media.matches)
    apply()
    if (!requested) media.addEventListener('change', apply)
}

export function mount(page: ReactNode): void {
    applyTheme()
    const locale = resolveShellLocale(shellLocal()?.locale, navigator.language)
    document.documentElement.lang = locale
    document.documentElement.dataset.platform = shellLocal()?.platform ?? 'mac'
    const kit = (Object.entries(kitPacks).find(([path]) => path.endsWith(`/${locale}/kit.json`))?.[1].default ?? englishKit) as typeof englishKit
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <IntlProvider locale={locale} messages={{ desktopApp: desktopAppMessages(locale) }} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
                <UiLocaleProvider locale={locale ?? DEFAULT_LOCALE} messages={{ kit: { ...englishKit, ...kit } }}>
                    {page}
                </UiLocaleProvider>
            </IntlProvider>
        </StrictMode>,
    )
}
