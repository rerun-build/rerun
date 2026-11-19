'use client'

import type { DesktopDownloadEvent, DesktopUpdateState, DesktopWindowState } from '@moldwright/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { desktopShell } from '@/lib/desktop-shell/client'

const UPDATE_TOAST_ID = 'desktop-update'
const DESKTOP_FULLSCREEN_ATTRIBUTE = 'data-desktop-fullscreen'

export function DesktopShellBridge() {
    const t = useTranslations('desktopShell')
    const locale = useLocale()

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

    useEffect(() => {
        const shell = desktopShell('window')
        if (!shell) return
        const apply = (state: DesktopWindowState) => document.documentElement.toggleAttribute(DESKTOP_FULLSCREEN_ATTRIBUTE, state.fullscreen)
        void shell.window.getState().then((state) => state && apply(state))
        return shell.window.onState(apply)
    }, [])

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

    useEffect(() => {
        const shell = desktopShell('find')
        if (!shell) return
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.key?.toLowerCase() !== 'f' || event.shiftKey || event.altKey) return
            if (shell.platform === 'mac' ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
            event.preventDefault()
            shell.find.open()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    useEffect(() => {
        desktopShell('locale')?.locale.set(locale)
    }, [locale])

    return null
}
