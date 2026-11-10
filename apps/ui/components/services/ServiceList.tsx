'use client'

import { useTranslations } from 'next-intl'
import { RequestConnectorDialog } from '@/components/services/RequestConnectorDialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { PanelList } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { serviceIconProps } from '@/lib/services/icons'
import type { ServiceSearchResult } from '@/lib/services/types'
import { SplitButton } from '@/components/ui/split-button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { Badge } from '@rerun/ui/primitives'
import { Trash2Icon, UnplugIcon } from '@/lib/icons'

type ServiceListProps = {
    services: ServiceSearchResult[]
    // When provided, each not-yet-installed service gets an Install button (used by the
    // Services settings tab). In chat we omit it — the agent drives installs via tools.
    onInstall?: (slug: string) => void
    // When provided alongside onInstall, a half-installed service can also be removed straight
    // from its library card instead of only from the Installed section.
    onUninstall?: (slug: string) => void
    // An installed app that takes several accounts offers to connect another one.
    onAddAccount?: (slug: string) => void
    // Why installing, finishing or adding an account is out of reach: the buttons stay, disabled.
    disabledReason?: string
}

export function ServiceList({ services, onInstall, onUninstall, onAddAccount, disabledReason }: ServiceListProps) {
    const t = useTranslations('services.list')
    const disabled = !!disabledReason
    if (services.length === 0) {
        return (
            <EmptyState
                className="py-8"
                icon={UnplugIcon}
                title={t('emptyTitle')}
                description={t('emptyDescription')}
                action={
                    <RequestConnectorDialog>
                        <Button size="sm" variant="outline">
                            {t('request')}
                        </Button>
                    </RequestConnectorDialog>
                }
            />
        )
    }

    return (
        <PanelList>
            {services.map(s => (
                <PanelRow
                    key={s.slug}
                    leading={<Icon {...serviceIconProps(s.icon, s.category)} size="sm" />}
                    title={
                        s.paidApp ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{s.name}</span>
                                <Badge size="xs" tone="brand" glow={false}>
                                    Pro
                                </Badge>
                            </span>
                        ) : (
                            s.name
                        )
                    }
                    description={s.summary}
                    actions={
                        s.installStatus === 'active' ? (
                            <>
                                <Badge size="xs" tone="green" glow={false}>
                                    {t('installed')}
                                </Badge>
                                {onAddAccount && s.multiInstance && (
                                    <TooltipDisabledReason reason={disabledReason}>
                                        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAddAccount(s.slug)}>
                                            {t('addAccount')}
                                        </Button>
                                    </TooltipDisabledReason>
                                )}
                            </>
                        ) : s.installStatus ? (
                            <>
                                <Badge size="xs" tone="orange" glow={false}>
                                    {s.installStatus === 'needs_auth' ? t('needsSignIn') : t('needsSetup')}
                                </Badge>
                                {onInstall && (
                                    <TooltipDisabledReason reason={disabledReason}>
                                        {onUninstall ? (
                                            <SplitButton size="sm" variant="outline" disabled={disabled} onClick={() => onInstall(s.slug)} actions={[{ label: t('removeApp'), icon: Trash2Icon, destructive: true, onSelect: () => onUninstall(s.slug) }]}>
                                                {t('finishSetup')}
                                            </SplitButton>
                                        ) : (
                                            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onInstall(s.slug)}>
                                                {t('finishSetup')}
                                            </Button>
                                        )}
                                    </TooltipDisabledReason>
                                )}
                            </>
                        ) : (
                            onInstall && (
                                <TooltipDisabledReason reason={disabledReason}>
                                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onInstall(s.slug)}>
                                        {t('install')}
                                    </Button>
                                </TooltipDisabledReason>
                            )
                        )
                    }
                />
            ))}
        </PanelList>
    )
}
