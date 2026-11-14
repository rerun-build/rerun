'use client'

import { useEffect } from 'react'
import { desktopShell } from '@/lib/desktop-shell/client'

const COUNT_PREFIX = /^\(\d+\+?\)\s/
const FAVICON_SIZE = 64
const ORIGINAL_HREF = 'data-original-href'

let badgedIcon: Promise<string | null> | null = null

function drawBadgedIcon(): Promise<string | null> {
    badgedIcon ??= new Promise(resolve => {
        const image = new Image()
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
            resolve(canvas.toDataURL('image/png'))
        }
        image.onerror = () => resolve(null)
        image.src = '/icon-192.png'
    })
    return badgedIcon
}

function setFavicon(href: string | null) {
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (!link.hasAttribute(ORIGINAL_HREF)) link.setAttribute(ORIGINAL_HREF, link.href)
        link.href = href ?? link.getAttribute(ORIGINAL_HREF) ?? link.href
    }
}

type BadgingNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

export function useTabSignals(count: number) {
    useEffect(() => {
        const label = count > 99 ? '99+' : String(count)
        const base = document.title.replace(COUNT_PREFIX, '')
        document.title = count > 0 ? `(${label}) ${base}` : base

        let cancelled = false
        if (count > 0) void drawBadgedIcon().then(href => !cancelled && href && setFavicon(href))
        else setFavicon(null)

        const badging = navigator as BadgingNavigator
        if (count > 0) badging.setAppBadge?.(count).catch(() => {})
        else badging.clearAppBadge?.().catch(() => {})
        desktopShell('badge')?.badge.set(count)

        return () => {
            cancelled = true
        }
    }, [count])

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
