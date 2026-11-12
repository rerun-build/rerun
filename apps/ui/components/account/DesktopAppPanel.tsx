'use client'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { desktopShell } from '@/lib/desktop-shell/client'
import type { DesktopSettings, DesktopUpdateState } from '@rerun/contracts'
import { Skeleton } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

// The desktop app's own settings, in the account dialog of the desktop app only.
export function DesktopAppPanel() {
    const t = useTranslations('desktopShell.settings')
    const shell = desktopShell('settings')
    const [settings, setSettings] = useState<DesktopSettings | null>(null)
    const [update, setUpdate] = useState<DesktopUpdateState>({ status: 'idle' })

    useEffect(() => {
        if (!shell) return
        void shell.settings.get().then(setSettings)
        const updates = desktopShell('update')
        if (!updates) return
        void updates.update.getState().then(setUpdate)
        return updates.update.onState(setUpdate)
    }, [shell])

    if (!shell) return null

    const change = async (patch: Partial<DesktopSettings>) => {
        setSettings((current) => (current ? { ...current, ...patch } : current))
        setSettings(await shell.settings.set(patch))
    }

    const updates = desktopShell('update')
    const updateLine =
        update.status === 'downloading' ? t('downloading', { percent: update.percent }) : update.status === 'checking' ? t('checking') : update.status === 'error' ? t('updateFailed') : t('version', { version: shell.version })

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-6">
            {settings ? (
                <>
                    <Field orientation="row" label={t('openAtLogin')} helperText={shell.platform === 'mac' ? t('openAtLoginMac') : t('openAtLoginOther')} htmlFor="desktop-open-at-login">
                        <Switch id="desktop-open-at-login" checked={settings.openAtLogin} onCheckedChange={(openAtLogin) => void change({ openAtLogin })} />
                    </Field>
                    {shell.platform !== 'mac' && (
                        <Field orientation="row" label={t('closeToTray')} helperText={t('closeToTrayHint')} htmlFor="desktop-close-to-tray">
                            <Switch id="desktop-close-to-tray" checked={settings.closeToTray} onCheckedChange={(closeToTray) => void change({ closeToTray })} />
                        </Field>
                    )}
                </>
            ) : (
                <div className="flex flex-col gap-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            )}
            <Field orientation="row" label={t('updates')} helperText={updateLine}>
                {update.status === 'ready' ? (
                    <Button size="sm" onClick={() => updates?.update.install()}>
                        {t('restart', { version: update.version })}
                    </Button>
                ) : (
                    <Button size="sm" variant="outline" disabled={!updates || update.status === 'checking' || update.status === 'downloading'} onClick={() => updates?.update.check()}>
                        {t('check')}
                    </Button>
                )}
            </Field>
        </div>
    )
}
