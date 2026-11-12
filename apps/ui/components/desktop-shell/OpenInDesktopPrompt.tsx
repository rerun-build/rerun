'use client'

import { isDesktopShell } from '@/lib/desktop-shell/client'
import { DESKTOP_APP_COOKIE, DESKTOP_OPEN_HOST, desktopShellScheme, isDesktopOpenPath, isDesktopShellChannel } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

const ASKED_KEY = 'rerun:open-in-desktop-asked'
const APP_NAMES = { stable: 'Rerun', staging: 'Rerun Staging', dev: 'Rerun Dev' } as const

function desktopChannel() {
    const value = document.cookie.match(new RegExp(`(?:^|; )${DESKTOP_APP_COOKIE}=([^;]*)`))?.[1]
    return isDesktopShellChannel(value) ? value : null
}

// A browser that signed a desktop app in offers, once per tab, to open the page in the app: the
// link of an email lands in the browser, the work happens in the app.
export function OpenInDesktopPrompt() {
    const t = useTranslations('desktopShell.openInApp')
    const pathname = usePathname()

    useEffect(() => {
        if (isDesktopShell() || pathname.startsWith('/auth')) return
        const channel = desktopChannel()
        if (!channel) return
        try {
            if (sessionStorage.getItem(ASKED_KEY)) return
            sessionStorage.setItem(ASKED_KEY, '1')
        } catch {
            return
        }
        const path = `${location.pathname}${location.search}`
        if (!isDesktopOpenPath(path)) return
        const link = `${desktopShellScheme(channel)}://${DESKTOP_OPEN_HOST}?path=${encodeURIComponent(path)}`
        toast(t('title', { app: APP_NAMES[channel] }), { duration: 10_000, action: { label: t('open'), onClick: () => window.location.assign(link) } })
    }, [pathname, t])

    return null
}
