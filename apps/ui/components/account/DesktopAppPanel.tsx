'use client'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ShortcutRecorder } from '@/components/account/ShortcutRecorder'
import { desktopShell } from '@/lib/desktop-shell/client'
import type { DesktopSettings, DesktopUpdateState, QuickAskShortcutKind } from '@rerun/contracts'
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

    const shortcutLabel = shell.platform === 'mac' ? '⌘⇧Space' : 'Ctrl+Shift+Space'
    const shortcuts = desktopShell('quickAskShortcut')
    const voiceShortcuts = desktopShell('quickAskVoiceShortcut')
    const quickAskShortcut = settings?.quickAskShortcut ?? null
    const quickAskVoiceShortcut = settings?.quickAskVoiceShortcut ?? null

    const changeShortcut = async (kind: QuickAskShortcutKind, accelerator: string | null) => {
        if (!shortcuts) return 'invalid' as const
        const result = await shortcuts.quickAsk.setShortcut(kind, accelerator)
        setSettings(result.settings)
        return result.status
    }
    const updates = desktopShell('update')
    const updateLine =
        update.status === 'downloading' ? t('downloading', { percent: update.percent }) : update.status === 'checking' ? t('checking') : update.status === 'error' ? t('updateFailed') : t('version', { version: shell.version })

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
            {settings ? (
                <>
                    <Field orientation="row" label={t('openAtLogin')} helperText={shell.platform === 'mac' ? t('openAtLoginMac') : t('openAtLoginOther')} htmlFor="desktop-open-at-login">
                        <Switch id="desktop-open-at-login" checked={settings.openAtLogin} onCheckedChange={(openAtLogin) => void change({ openAtLogin })} />
                    </Field>
                    {shortcuts ? (
                        <Field orientation="row" label={t('quickAsk')} helperText={quickAskShortcut ? t('quickAskOn') : t('quickAskOff')} htmlFor="desktop-quick-ask">
                            <ShortcutRecorder
                                id="desktop-quick-ask"
                                value={quickAskShortcut}
                                platform={shell.platform}
                                onRecordingChange={(recording) => shortcuts.quickAsk.pauseShortcuts(recording)}
                                onChange={(accelerator) => changeShortcut('text', accelerator)}
                            />
                        </Field>
                    ) : (
                        <Field orientation="row" label={t('quickAsk')} helperText={t('quickAskHint', { shortcut: shortcutLabel })} htmlFor="desktop-quick-ask">
                            <Switch id="desktop-quick-ask" checked={settings.quickAsk} onCheckedChange={(quickAsk) => void change({ quickAsk })} />
                        </Field>
                    )}
                    {voiceShortcuts && (
                        <Field orientation="row" label={t('quickAskVoice')} helperText={quickAskVoiceShortcut ? t('quickAskVoiceOn') : t('quickAskOff')} htmlFor="desktop-quick-ask-voice">
                            <ShortcutRecorder
                                id="desktop-quick-ask-voice"
                                value={quickAskVoiceShortcut}
                                platform={shell.platform}
                                onRecordingChange={(recording) => voiceShortcuts.quickAsk.pauseShortcuts(recording)}
                                onChange={(accelerator) => changeShortcut('voice', accelerator)}
                            />
                        </Field>
                    )}
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
