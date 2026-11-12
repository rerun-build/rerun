'use client'

import type { DesktopDownloadEvent, DesktopUpdateState } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { desktopShell } from '@/lib/desktop-shell/client'

const UPDATE_TOAST_ID = 'desktop-update'

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

    return null
}
