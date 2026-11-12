import { app } from 'electron'
import type { Locale } from '@rerun/i18n'
import { createTranslator } from 'use-intl/core'
import { desktopAppMessages, resolveShellLocale } from '../shared/messages'
import { readSettings, updateSettings } from './settings'

// The language of the menus and dialogs: the one the web app last told (the person's choice in
// Rerun), else the system's.
let locale: Locale = resolveShellLocale(readSettings().locale, ...app.getPreferredSystemLanguages())
let translator = createTranslator({ locale, messages: desktopAppMessages(locale) })
const listeners = new Set<() => void>()

export function shellLocale(): Locale {
    return locale
}

export function t(key: string, values?: Record<string, string | number>): string {
    return translator(key as never, values as never)
}

export function setShellLocale(requested: string): void {
    const next = resolveShellLocale(requested)
    updateSettings({ locale: next })
    if (next === locale) return
    locale = next
    translator = createTranslator({ locale, messages: desktopAppMessages(locale) })
    for (const listener of listeners) listener()
}

export function onLocaleChange(listener: () => void): void {
    listeners.add(listener)
}
