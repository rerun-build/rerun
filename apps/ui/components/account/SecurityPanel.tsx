'use client'

import type { SecurityPasskey, SecuritySession, SecurityState } from '@/app/api/_actions/two-step.actions'
import { PasskeyDeviceLogo } from '@/components/account/PasskeyDeviceLogo'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PANEL_CARD, PanelRow } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { BACKUP_CODE_COUNT } from '@/lib/auth/two-step/record'
import type { SessionDevice } from '@/lib/auth/two-step/devices'
import { KeyIcon, LockKeyholeIcon, MonitorIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Smartphone, Trash2Icon } from '@/lib/icons'
import { shortDate, timeAgo } from '@rerun/i18n/format'
import { Badge, PanelSection } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export type SecurityPanelProps = {
    // Null while the account's methods and sessions are being read.
    security: SecurityState | null
    // Why a passkey cannot be added here (the desktop app on a Mac reaches no Touch ID).
    addPasskeyUnavailable?: string
    busy?: string | null
    onSetUpApp: () => void
    onAddPasskey: () => void
    onRenamePasskey: (passkey: SecurityPasskey) => void
    onRemoveMethod: (methodId: string) => void
    onNewCodes: () => void
    onSignOutSession: (sessionId: string) => void
    onSignOutOthers: () => void
}

function useDeviceLabel() {
    const t = useTranslations('account.security.sessions.device')
    return (device: SessionDevice): string => {
        if (device.app === 'ios') return t('ios')
        if (device.app === 'android') return t('android')
        if (device.app === 'desktop') return device.os ? t('desktopOn', { os: device.os }) : t('desktop')
        if (device.app === 'browser') {
            if (device.browser && device.os) return t('browserOn', { browser: device.browser, os: device.os })
            if (device.browser) return t('browser', { browser: device.browser })
            if (device.os) return t('browserOnOs', { os: device.os })
        }
        return t('unknown')
    }
}

function isPhone(device: SessionDevice): boolean {
    return device.app === 'ios' || device.app === 'android' || (device.app === 'browser' && device.phone)
}

function RemoveMethod({ title, lastMethod, busy, onConfirm, children }: { title: string; lastMethod: boolean; busy: boolean; onConfirm: () => void; children: ReactNode }) {
    const t = useTranslations('account.security')
    return (
        <ConfirmDialog title={title} description={lastMethod ? t('lastMethod') : undefined} confirmLabel={t('remove')} pending={busy} onConfirm={onConfirm}>
            {children}
        </ConfirmDialog>
    )
}

// Hidden on a phone, where the row's own button already says the method is on and the title needs the room.
function OnBadge() {
    const t = useTranslations('account.security')
    return (
        <Badge size="xs" tone="green" className="max-sm:hidden">
            {t('on')}
        </Badge>
    )
}

function PasskeyItem({ passkey, lastMethod, busy, onRename, onRemove }: { passkey: SecurityPasskey; lastMethod: boolean; busy: boolean; onRename: () => void; onRemove: () => void }) {
    const t = useTranslations('account.security')
    const locale = useLocale()
    const added = shortDate(passkey.createdAt, locale)
    const removeLabel = t('passkeys.removeTitle', { name: passkey.name })
    return (
        <li className="flex items-center gap-3 border-t border-border py-2.5 ps-3 pe-3 sm:ps-14">
            <PasskeyDeviceLogo name={passkey.name} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{passkey.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {passkey.lastUsedAt ? t('passkeys.used', { added, used: timeAgo(passkey.lastUsedAt, locale) }) : t('passkeys.neverUsed', { added })}
                </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <TooltipLabeled label={t('passkeys.rename')}>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('passkeys.rename')} onClick={onRename}>
                        <PencilIcon />
                    </Button>
                </TooltipLabeled>
                <TooltipLabeled label={t('remove')}>
                    <span className="inline-flex">
                        <RemoveMethod title={removeLabel} lastMethod={lastMethod} busy={busy} onConfirm={onRemove}>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={removeLabel} loading={busy}>
                                <Trash2Icon />
                            </Button>
                        </RemoveMethod>
                    </span>
                </TooltipLabeled>
            </div>
        </li>
    )
}

function SessionRow({ session, busy, onSignOut }: { session: SecuritySession; busy: boolean; onSignOut: () => void }) {
    const t = useTranslations('account.security.sessions')
    const locale = useLocale()
    const deviceLabel = useDeviceLabel()
    return (
        <PanelRow
            leading={<Icon icon={isPhone(session.device) ? Smartphone : MonitorIcon} size="sm" />}
            title={deviceLabel(session.device)}
            description={session.activeNow || !session.lastActiveAt ? t('activeNow') : timeAgo(session.lastActiveAt, locale)}
            actions={
                session.current ? (
                    <Badge size="xs" tone="brand">
                        {t('thisDevice')}
                    </Badge>
                ) : (
                    <Button type="button" variant="outline" size="sm" loading={busy} onClick={onSignOut}>
                        {t('signOut')}
                    </Button>
                )
            }
        />
    )
}

export function SecurityPanel({ security, addPasskeyUnavailable, busy = null, onSetUpApp, onAddPasskey, onRenamePasskey, onRemoveMethod, onNewCodes, onSignOutSession, onSignOutOthers }: SecurityPanelProps) {
    const t = useTranslations('account.security')
    const locale = useLocale()
    if (!security) {
        return (
            <div className="px-1 py-2">
                <SkeletonPanelRows rows={5} lines={2} leading />
            </div>
        )
    }

    const { app, passkeys, backupCodesLeft, sessions } = security
    const methodCount = (app ? 1 : 0) + passkeys.length
    const on = methodCount > 0
    const others = sessions.filter(session => !session.current)

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <PanelSection label={t('twoStep')}>
                {!on && <p className="text-xs text-muted-foreground">{t('hint')}</p>}
                <PanelRow
                    leading={<Icon icon={LockKeyholeIcon} size="sm" />}
                    title={t('app.title')}
                    description={app ? t('app.added', { date: shortDate(app.createdAt, locale) }) : t('app.description')}
                    actions={
                        app ? (
                            <>
                                <OnBadge />
                                <RemoveMethod title={t('app.removeTitle')} lastMethod={methodCount === 1} busy={busy === app.id} onConfirm={() => onRemoveMethod(app.id)}>
                                    <Button type="button" variant="outline" size="sm" className="ms-1" loading={busy === app.id}>
                                        {t('remove')}
                                    </Button>
                                </RemoveMethod>
                            </>
                        ) : (
                            <Button type="button" variant="outline" size="sm" loading={busy === 'app'} onClick={onSetUpApp}>
                                {t('app.setUp')}
                            </Button>
                        )
                    }
                />
                <div className={PANEL_CARD}>
                    <PanelRow
                        className="border-0 bg-transparent"
                        leading={<Icon icon={KeyIcon} size="sm" />}
                        title={t('passkeys.title')}
                        description={t('passkeys.description')}
                        actions={
                            <>
                                {passkeys.length > 0 && <OnBadge />}
                                <TooltipDisabledReason reason={addPasskeyUnavailable}>
                                    <Button type="button" variant="outline" size="sm" className="ms-1" disabled={!!addPasskeyUnavailable} loading={busy === 'passkey'} onClick={onAddPasskey}>
                                        <PlusIcon />
                                        {t('passkeys.add')}
                                    </Button>
                                </TooltipDisabledReason>
                            </>
                        }
                    />
                    {passkeys.length > 0 && (
                        <ul>
                            {passkeys.map(passkey => (
                                <PasskeyItem key={passkey.id} passkey={passkey} lastMethod={methodCount === 1} busy={busy === passkey.id} onRename={() => onRenamePasskey(passkey)} onRemove={() => onRemoveMethod(passkey.id)} />
                            ))}
                        </ul>
                    )}
                </div>
                {on && backupCodesLeft !== null && (
                    <PanelRow
                        leading={<Icon icon={ShieldCheckIcon} size="sm" />}
                        title={t('backup.title')}
                        description={t('backup.description', { left: backupCodesLeft, total: BACKUP_CODE_COUNT })}
                        actions={
                            <ConfirmDialog title={t('backup.newTitle')} description={t('backup.newDescription')} confirmLabel={t('backup.newCodes')} confirmVariant="default" pending={busy === 'codes'} onConfirm={onNewCodes}>
                                <Button type="button" variant="outline" size="sm" loading={busy === 'codes'}>
                                    {t('backup.newCodes')}
                                </Button>
                            </ConfirmDialog>
                        }
                    />
                )}
            </PanelSection>

            <PanelSection label={t('sessions.title')}>
                {sessions.map(session => (
                    <SessionRow key={session.id} session={session} busy={busy === session.id} onSignOut={() => onSignOutSession(session.id)} />
                ))}
                {others.length > 0 && (
                    <div className="flex justify-end">
                        <ConfirmDialog
                            title={t('sessions.signOutOthersTitle')}
                            description={t('sessions.signOutOthersDescription')}
                            confirmLabel={t('sessions.signOutOthers')}
                            pending={busy === 'others'}
                            onConfirm={onSignOutOthers}
                        >
                            <Button type="button" variant="ghost" size="sm" loading={busy === 'others'}>
                                {t('sessions.signOutOthers')}
                            </Button>
                        </ConfirmDialog>
                    </div>
                )}
            </PanelSection>
        </div>
    )
}
