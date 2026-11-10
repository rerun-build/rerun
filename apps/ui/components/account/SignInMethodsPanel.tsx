'use client'

import type { ConnectedIdentity, SignInMethods } from '@/app/api/_actions/account.actions'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelRow } from '@/components/ui/panel-row'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ENABLED_OAUTH_PROVIDERS, OAUTH_PROVIDER_CONFIG, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { Mail, Smartphone } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

const PROVIDER_GLYPHS: Record<OAuthProvider, ComponentType<{ className?: string }>> = {
    google: ({ className }) => <ProviderIcon provider="google" className={className} />,
    apple: ({ className }) => <ProviderIcon provider="apple" className={className} />,
}

function OAuthRow({
    provider,
    identity,
    unavailableReason,
    busy,
    onConnect,
    onDisconnect,
}: {
    provider: OAuthProvider
    identity: ConnectedIdentity | null
    unavailableReason?: string
    busy: boolean
    onConnect: () => void
    onDisconnect: () => void
}) {
    const t = useTranslations('account.signIn')
    const { label } = OAUTH_PROVIDER_CONFIG[provider]

    return (
        <PanelRow
            leading={<Icon icon={PROVIDER_GLYPHS[provider]} size="sm" />}
            title={label}
            description={identity ? (identity.email ?? t('connected')) : t('notConnected')}
            actions={
                identity ? (
                    <TooltipDisabledReason reason={identity.canDisconnect ? undefined : t('onlyMethod', { provider: label })}>
                        <ConfirmDialog
                            title={t('disconnectTitle', { provider: label })}
                            description={t('disconnectDescription', { provider: label })}
                            confirmLabel={t('disconnect')}
                            pending={busy}
                            onConfirm={onDisconnect}
                        >
                            <Button type="button" variant="outline" size="sm" disabled={!identity.canDisconnect} loading={busy}>
                                {t('disconnect')}
                            </Button>
                        </ConfirmDialog>
                    </TooltipDisabledReason>
                ) : (
                    <TooltipDisabledReason reason={unavailableReason}>
                        <Button type="button" variant="outline" size="sm" disabled={!!unavailableReason} loading={busy} onClick={onConnect}>
                            {t('connect')}
                        </Button>
                    </TooltipDisabledReason>
                )
            }
        />
    )
}

export type SignInMethodsPanelProps = {
    // Null while the account's methods are being read.
    methods: SignInMethods | null
    // Why a provider cannot be connected from here, an in-app browser Google refuses for one.
    unavailableReasons?: Partial<Record<OAuthProvider, string>>
    busyProvider?: OAuthProvider | null
    onChangeEmail: () => void
    // Absent where phone sign-in is not offered: the row is left out.
    onChangePhone?: () => void
    onConnect: (provider: OAuthProvider) => void
    onDisconnect: (provider: OAuthProvider) => void
}

export function SignInMethodsPanel({ methods, unavailableReasons, busyProvider = null, onChangeEmail, onChangePhone, onConnect, onDisconnect }: SignInMethodsPanelProps) {
    const t = useTranslations('account.signIn')
    if (!methods) {
        return (
            <div className="px-1 py-2 sm:px-3">
                <SkeletonPanelRows rows={4} lines={2} leading />
            </div>
        )
    }

    const { email, oauth, phone } = methods

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-5 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6">
            <PanelRow
                leading={<Icon icon={Mail} size="sm" />}
                title={t('email.title')}
                description={email ?? t('email.empty')}
                actions={
                    <Button type="button" variant="outline" size="sm" onClick={onChangeEmail}>
                        {email ? t('change') : t('add')}
                    </Button>
                }
            />

            {ENABLED_OAUTH_PROVIDERS.map(provider => (
                <OAuthRow
                    key={provider}
                    provider={provider}
                    identity={oauth[provider]}
                    unavailableReason={unavailableReasons?.[provider]}
                    busy={busyProvider === provider}
                    onConnect={() => onConnect(provider)}
                    onDisconnect={() => onDisconnect(provider)}
                />
            ))}

            {onChangePhone && (
                <PanelRow
                    leading={<Icon icon={Smartphone} size="sm" />}
                    title={t('phone.title')}
                    description={phone ? phone.number : t('phone.empty')}
                    footer={phone && !phone.signsInHere ? t('phone.otherAccount') : undefined}
                    actions={
                        <Button type="button" variant="outline" size="sm" onClick={onChangePhone}>
                            {phone ? t('change') : t('add')}
                        </Button>
                    }
                />
            )}
        </div>
    )
}
