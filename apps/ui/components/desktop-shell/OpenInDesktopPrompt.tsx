'use client'

import { isDesktopShell } from '@/lib/desktop-shell/client'
import { DESKTOP_APP_COOKIE, DESKTOP_OPEN_HOST, desktopShellScheme, isDesktopOpenPath, isDesktopShellChannel } from '@moldwright/contracts'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

const ASKED_KEY = 'rerun:open-in-desktop-asked'
const APP_NAMES = { stable: 'Moldwright', staging: 'Moldwright Staging', dev: 'Moldwright Dev' } as const

function desktopChannel() {
    const value = document.cookie.match(new RegExp(`(?:^|; )${DESKTOP_APP_COOKIE}=([^;]*)`))?.[1]
    return isDesktopShellChannel(value) ? value : null
}

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
