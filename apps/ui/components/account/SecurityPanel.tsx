'use client'

import type { SecurityPasskey, SecuritySession, SecurityState } from '@/app/api/_actions/two-step.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelRow } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { BACKUP_CODE_COUNT } from '@/lib/auth/two-step/record'
import type { SessionDevice } from '@/lib/auth/two-step/devices'
import { KeyIcon, LockKeyholeIcon, MonitorIcon, PencilIcon, ShieldCheckIcon, Smartphone, Trash2Icon } from '@/lib/icons'
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
    onRemoveMethod: (factorId: string) => void
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

function PasskeyRow({ passkey, lastMethod, busy, onRename, onRemove }: { passkey: SecurityPasskey; lastMethod: boolean; busy: boolean; onRename: () => void; onRemove: () => void }) {
    const t = useTranslations('account.security.passkeys')
    const locale = useLocale()
    const added = shortDate(passkey.createdAt, locale)
    return (
        <PanelRow
            leading={<Icon icon={KeyIcon} size="sm" />}
            title={passkey.name}
            description={passkey.lastUsedAt ? t('used', { added, used: timeAgo(passkey.lastUsedAt, locale) }) : t('neverUsed', { added })}
            actions={
                <>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rename')} onClick={onRename}>
                        <PencilIcon />
                    </Button>
                    <RemoveMethod title={t('removeTitle', { name: passkey.name })} lastMethod={lastMethod} busy={busy} onConfirm={onRemove}>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removeTitle', { name: passkey.name })} loading={busy}>
                            <Trash2Icon />
                        </Button>
                    </RemoveMethod>
                </>
            }
        />
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
            meta={
                session.current ? (
                    <Badge size="xs" tone="brand">
                        {t('thisDevice')}
                    </Badge>
                ) : undefined
            }
            description={session.activeNow || !session.lastActiveAt ? t('activeNow') : timeAgo(session.lastActiveAt, locale)}
            actions={
                session.current ? undefined : (
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
                    meta={
                        app ? (
                            <Badge size="xs" tone="green">
                                {t('on')}
                            </Badge>
                        ) : undefined
                    }
                    description={app ? t('app.added', { date: shortDate(app.createdAt, locale) }) : t('app.description')}
                    actions={
                        app ? (
                            <RemoveMethod title={t('app.removeTitle')} lastMethod={methodCount === 1} busy={busy === app.id} onConfirm={() => onRemoveMethod(app.id)}>
                                <Button type="button" variant="outline" size="sm" loading={busy === app.id}>
                                    {t('remove')}
                                </Button>
                            </RemoveMethod>
                        ) : (
                            <Button type="button" variant="outline" size="sm" loading={busy === 'app'} onClick={onSetUpApp}>
                                {t('app.setUp')}
                            </Button>
                        )
                    }
                />
                <PanelRow
                    leading={<Icon icon={KeyIcon} size="sm" />}
                    title={t('passkeys.title')}
                    meta={
                        passkeys.length ? (
                            <Badge size="xs" tone="green">
                                {passkeys.length}
                            </Badge>
                        ) : undefined
                    }
                    description={t('passkeys.description')}
                    actions={
                        <TooltipDisabledReason reason={addPasskeyUnavailable}>
                            <Button type="button" variant="outline" size="sm" disabled={!!addPasskeyUnavailable} loading={busy === 'passkey'} onClick={onAddPasskey}>
                                {t('passkeys.add')}
                            </Button>
                        </TooltipDisabledReason>
                    }
                />
                {passkeys.length > 0 && (
                    <div className="space-y-2 ps-4">
                        {passkeys.map(passkey => (
                            <PasskeyRow key={passkey.id} passkey={passkey} lastMethod={methodCount === 1} busy={busy === passkey.id} onRename={() => onRenamePasskey(passkey)} onRemove={() => onRemoveMethod(passkey.id)} />
                        ))}
                    </div>
                )}
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
