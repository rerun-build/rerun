'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@rerun/ui/primitives'

import { attachVaultPaidAccountAction, detachVaultPaidAccountAction } from '@/app/api/_actions/vault.actions'
import type { VaultPaidAccount } from '@/app/api/_services/vault-apps.service'
import type { VaultListing } from '@/app/api/_services/vault.service'
import { AppIcon } from '@/components/apps/PaidAppViews'
import { Group } from '@/components/connections/AiProvidersPanel'
import { Button } from '@/components/ui/button'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { appInfo } from '@/lib/apps/catalog'
import { ChevronLeftIcon } from '@/lib/icons'

type Props = { account: VaultPaidAccount; listing: VaultListing; onBack: () => void; onChanged: () => Promise<void> }

// An account of a paid app, seen from the Vault: only who acts with it. Its sign-in, its slot and its
// bill stay in the app's own window.
export function VaultPaidAccountDetail({ account, listing, onBack, onChanged }: Props) {
    const t = useTranslations('vault')
    const errorText = useErrorText()
    const [busy, setBusy] = useState<string | null>(null)

    const toggle = async (agentId: string, on: boolean) => {
        setBusy(agentId)
        const res = on ? await attachVaultPaidAccountAction(account.slug, account.connectionId, agentId) : await detachVaultPaidAccountAction(account.slug, account.connectionId, agentId)
        if (!res.ok) toast.error(errorText(res, t('errors.changeFailed')))
        await onChanged()
        setBusy(null)
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b px-3 py-2.5">
                <Button aria-label={t('detail.back')} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
                    <ChevronLeftIcon className="size-4" />
                </Button>
                <AppIcon slug={account.slug} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{account.name}</span>
                    {account.label && <span className="truncate text-[11px] text-muted-foreground">{account.label}</span>}
                </div>
                <PaidAccountStatusBadge account={account} />
            </div>

            <PanelScroller className="space-y-6 p-4">
                <p className="text-xs text-muted-foreground">{t('paid.managedInApp', { provider: appInfo(account.slug).providerLabel })}</p>

                <Group title={t('detail.coworkers')}>
                    <TooltipDisabledReason reason={t('reasons.paidAppEveryone')} className="flex w-full">
                        <PanelRow title={t('detail.everyone')} description={t('detail.everyoneHint')} actions={<Switch checked={false} disabled aria-label={t('detail.everyone')} />} />
                    </TooltipDisabledReason>
                    {listing.coworkers.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.noCoworkers')}</p>}
                    {listing.coworkers.map(coworker => {
                        const reason = !coworker.canManage ? t('reasons.manageBox') : undefined
                        return (
                            <TooltipDisabledReason key={coworker.id} reason={reason} className="flex w-full">
                                <PanelRow
                                    title={coworker.name}
                                    actions={
                                        <Switch
                                            checked={account.agentIds.includes(coworker.id)}
                                            disabled={!!reason || busy !== null}
                                            aria-label={coworker.name}
                                            onCheckedChange={checked => void toggle(coworker.id, checked)}
                                        />
                                    }
                                />
                            </TooltipDisabledReason>
                        )
                    })}
                    {account.hiddenAgents > 0 && <p className="px-1 text-xs text-muted-foreground">{t('detail.hiddenCoworkers', { count: account.hiddenAgents })}</p>}
                </Group>
            </PanelScroller>
        </div>
    )
}

export function PaidAccountStatusBadge({ account }: { account: Pick<VaultPaidAccount, 'status'> }) {
    const t = useTranslations('vault')
    if (account.status === 'needs_reconnect') {
        return (
            <Badge size="xs" tone="orange" glow={false}>
                {t('status.needsAuth')}
            </Badge>
        )
    }
    if (account.status === 'paused' || account.status === 'connecting') {
        return (
            <Badge size="xs" tone="neutral" glow={false}>
                {t(account.status === 'paused' ? 'paid.paused' : 'paid.connecting')}
            </Badge>
        )
    }
    return null
}
