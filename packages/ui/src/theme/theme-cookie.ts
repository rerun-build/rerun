export const THEME_COOKIE = 'rerun-theme'

export const THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export const THEME_STORAGE_KEY = 'theme'

export type ThemePreference = 'light' | 'dark' | 'system'

export function parseThemePreference(value: string | null | undefined): ThemePreference {
    return value === 'light' || value === 'dark' ? value : 'system'
}

export function themeClass(preference: ThemePreference): string {
    return preference === 'dark' ? 'dark' : ''
}
