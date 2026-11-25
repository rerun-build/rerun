'use client'

import { useEffect } from 'react'
import { useBrand } from '@/components/brand/BrandProvider'
import { appIconUrl } from '@/lib/brand/icons'
import { desktopShell } from '@/lib/desktop-shell/client'

const COUNT_PREFIX = /^\(\d+\+?\)\s/
const FAVICON_SIZE = 64
const ORIGINAL_HREF = 'data-original-href'

const badgedIcons = new Map<string, Promise<string | null>>()

// The app icon with a red dot in its corner, drawn once per icon and reused.
function drawBadgedIcon(iconUrl: string): Promise<string | null> {
    const drawn = badgedIcons.get(iconUrl)
    if (drawn) return drawn
    const badgedIcon = new Promise<string | null>(resolve => {
        const image = new Image()
        // An organization's icon is served from another origin, and a canvas only hands back pixels it
        // was allowed to read.
        image.crossOrigin = 'anonymous'
        image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = FAVICON_SIZE
            canvas.height = FAVICON_SIZE
            const context = canvas.getContext('2d')
            if (!context) return resolve(null)
            context.drawImage(image, 0, 0, FAVICON_SIZE, FAVICON_SIZE)
            const radius = FAVICON_SIZE * 0.22
            const center = FAVICON_SIZE - radius
            context.beginPath()
            context.arc(center, radius, radius, 0, Math.PI * 2)
            context.fillStyle = '#ef4444'
            context.fill()
            try {
                resolve(canvas.toDataURL('image/png'))
            } catch {
                resolve(null)
            }
        }
        image.onerror = () => resolve(null)
        image.src = iconUrl
    })
    badgedIcons.set(iconUrl, badgedIcon)
    return badgedIcon
}

function setFavicon(href: string | null) {
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (!link.hasAttribute(ORIGINAL_HREF)) link.setAttribute(ORIGINAL_HREF, link.href)
        link.href = href ?? link.getAttribute(ORIGINAL_HREF) ?? link.href
    }
}

type BadgingNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

// What is waiting for you, seen from outside the tab: « (3) Rerun » in the title, a dot on the
// favicon, and the count on the icon of the installed app.
export function useTabSignals(count: number) {
    const iconUrl = appIconUrl(useBrand())
    useEffect(() => {
        const label = count > 99 ? '99+' : String(count)
        const base = document.title.replace(COUNT_PREFIX, '')
        document.title = count > 0 ? `(${label}) ${base}` : base

        let cancelled = false
        if (count > 0) void drawBadgedIcon(iconUrl).then(href => !cancelled && href && setFavicon(href))
        else setFavicon(null)

        const badging = navigator as BadgingNavigator
        if (count > 0) badging.setAppBadge?.(count).catch(() => {})
        else badging.clearAppBadge?.().catch(() => {})
        // The desktop app puts it on the Dock, the taskbar and its tray icon.
        desktopShell('badge')?.badge.set(count)

        return () => {
            cancelled = true
        }
    }, [count, iconUrl])

    useEffect(
        () => () => {
            document.title = document.title.replace(COUNT_PREFIX, '')
            setFavicon(null)
            ;(navigator as BadgingNavigator).clearAppBadge?.().catch(() => {})
            desktopShell('badge')?.badge.set(0)
        },
        []
    )
}
