'use client'

import type { DesktopDownloadEvent, DesktopUpdateState, DesktopWindowState } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { desktopShell } from '@/lib/desktop-shell/client'

const UPDATE_TOAST_ID = 'desktop-update'
const DESKTOP_FULLSCREEN_ATTRIBUTE = 'data-desktop-fullscreen'

// What the desktop app tells the page and the page shows in its own toasts: an app update ready to
// install, a file it downloaded. Renders nothing, and does nothing in a browser.
export function DesktopShellBridge() {
    const t = useTranslations('desktopShell')

    useEffect(() => {
        const shell = desktopShell('update')
        if (!shell) return
        const onState = (state: DesktopUpdateState) => {
            if (state.status !== 'ready') return
            toast(t('update.ready', { version: state.version }), {
                id: UPDATE_TOAST_ID,
                description: t('update.description'),
                duration: Infinity,
                action: { label: t('update.restart'), onClick: () => shell.update.install() },
            })
        }
        void shell.update.getState().then(onState)
        return shell.update.onState(onState)
    }, [t])

    useEffect(() => {
        const shell = desktopShell('downloads')
        if (!shell) return
        return shell.downloads.onEvent((event: DesktopDownloadEvent) => {
            if (event.state === 'completed') {
                toast.success(t('downloads.done', { filename: event.filename }), { id: event.id, action: { label: t('downloads.show'), onClick: () => shell.downloads.show(event.id) } })
            }
            if (event.state === 'interrupted') toast.error(t('downloads.failed', { filename: event.filename }), { id: event.id })
        })
    }, [t])

    // Native full screen hides the window's buttons: the strip folds away with them.
    useEffect(() => {
        const shell = desktopShell('window')
        if (!shell) return
        const apply = (state: DesktopWindowState) => document.documentElement.toggleAttribute(DESKTOP_FULLSCREEN_ATTRIBUTE, state.fullscreen)
        void shell.window.getState().then((state) => state && apply(state))
        return shell.window.onState(apply)
    }, [])

    // Windows and Linux draw their caption buttons over the strip: transparent, so the strip shows
    // through, with symbols that read on the page's theme. The shell's own pages (find bar, offline)
    // take the same theme.
    useEffect(() => {
        const shell = desktopShell('window')
        if (!shell) return
        const root = document.documentElement
        const apply = () => shell.window.setChrome({ frameColor: '#00000000', symbolColor: root.classList.contains('dark') ? '#fafafa' : '#0a0a0a' })
        apply()
        const observer = new MutationObserver(apply)
        observer.observe(root, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    return null
}
