'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { PanelRow } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CustomMcpStatusBadge } from '@/components/services/CustomMcpStatusBadge'
import { serviceIconProps } from '@/lib/services/icons'
import type { CustomMcpServer, CustomMcpStatus } from '@/lib/services/types'
import { PencilIcon } from '@/lib/icons'
import { Badge } from '@rerun/ui/primitives'

type CustomMcpRowProps = {
    server: CustomMcpServer
    status: CustomMcpStatus | undefined
    statusLoading: boolean
    onConnect: () => void
    onEdit: () => void
    onRemove: () => void
    // Why connecting, editing or removing the server is out of reach: the buttons stay, disabled.
    disabledReason?: string
}

export function CustomMcpRow({ server, status, statusLoading, onConnect, onEdit, onRemove, disabledReason }: CustomMcpRowProps) {
    const t = useTranslations('services.customMcp')
    const disabled = !!disabledReason
    const canSignIn = status?.status === 'needs_auth' && !!server.signInUrl
    return (
        <PanelRow
            leading={<Icon {...serviceIconProps(server.icon, 'custom')} size="sm" />}
            title={
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{server.displayName}</span>
                    <Badge size="xs" tone="neutral" glow={false}>
                        {t('custom')}
                    </Badge>
                </span>
            }
            description={server.host ?? server.transport}
            actions={
                <>
                    <span className="mr-2 flex items-center empty:hidden">
                        <CustomMcpStatusBadge status={status} loading={statusLoading} />
                    </span>
                    {canSignIn && (
                        <TooltipDisabledReason reason={disabledReason}>
                            <Button size="sm" variant="outline" disabled={disabled} onClick={onConnect}>
                                {t('connect')}
                            </Button>
                        </TooltipDisabledReason>
                    )}
                    <TooltipDisabledReason reason={disabledReason}>
                        <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={t('edit', { name: server.displayName })} disabled={disabled} onClick={onEdit}>
                            <PencilIcon />
                        </Button>
                    </TooltipDisabledReason>
                    <TooltipDisabledReason reason={disabledReason}>
                        <PanelDeleteButton
                            label={t('remove', { name: server.displayName })}
                            disabled={disabled}
                            onClick={onRemove}
                            confirmTitle={t('removeTitle', { name: server.displayName })}
                            confirmDescription={t('removeDescription')}
                            confirmLabel={t('removeConfirm')}
                        />
                    </TooltipDisabledReason>
                </>
            }
        />
    )
}
