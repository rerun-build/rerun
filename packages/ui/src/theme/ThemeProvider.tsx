'use client'

import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { useEffect } from 'react'

import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemePreference } from './theme-cookie'

function ThemeCookieSync() {
    const { theme } = useTheme()

    useEffect(() => {
        if (!theme) return
        const parts = [`${THEME_COOKIE}=${theme}`, 'path=/', `max-age=${THEME_COOKIE_MAX_AGE}`, 'SameSite=Lax']
        if (window.location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
        if (window.location.protocol === 'https:') parts.push('Secure')
        document.cookie = parts.join('; ')
    }, [theme])

    return null
}

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_THEME: ThemePreference = process.env.NODE_ENV === 'development' ? 'dark' : 'system'

export function ThemeProvider({
    defaultTheme = DEFAULT_THEME,
    children,
}: {
    defaultTheme?: ThemePreference
    children: React.ReactNode
}) {
    return (
        <NextThemesProvider attribute="class" defaultTheme={defaultTheme} enableSystem disableTransitionOnChange>
            <ThemeCookieSync />
            {children}
        </NextThemesProvider>
    )
}
