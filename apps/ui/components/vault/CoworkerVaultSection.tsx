'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { attachVaultEntryAction, coworkerVaultAction, detachVaultEntryAction } from '@/app/api/_actions/vault.actions'
import type { CoworkerVault } from '@/app/api/_services/vault.service'
import { useVaultEnabled } from '@/components/layout/FeatureFlagsProvider'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelList, PanelSection } from '@/components/ui/panel-list'
import { PanelDeleteButton } from '@/components/ui/panel-editor'
import { PanelRow } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { useErrorText } from '@/hooks/useErrorText'
import { KeyIcon, ServerIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import type { VaultItemSummary } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'

type Change = (item: VaultItemSummary, attach: boolean) => Promise<void>

// The coworker's side of the Vault, read with the tab and again each time its list changes.
export function useCoworkerVault(agentId: string, revision: number, onChanged: () => Promise<void>, onError: (message: string) => void) {
    const enabled = useVaultEnabled()
    const t = useTranslations('agent.agentPanelServices')
    const errorText = useErrorText()
    const [vault, setVault] = useState<CoworkerVault | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    const read = useCallback(async () => setVault(await coworkerVaultAction(agentId)), [agentId])
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (enabled) void read()
    }, [enabled, read, revision])

    const change: Change = async (item, attach) => {
        setBusy(item.id)
        const res = attach ? await attachVaultEntryAction(item.id, agentId) : await detachVaultEntryAction(item.id, agentId)
        if (!res.ok) onError(errorText(res, t('vaultAttachFailed', { name: item.name })))
        await Promise.all([read(), onChanged()])
        setBusy(null)
    }

    return { vault: enabled ? vault : null, busy, change }
}

type Rows = { vault: CoworkerVault | null; busy: string | null; change: Change; disabledReason?: string }

function useVaultIcons(items: VaultItemSummary[]) {
    const slugs = useMemo(() => [...new Set(items.flatMap(item => (item.slug ? [item.slug] : [])))], [items])
    const { resolved } = useCatalogServices(slugs)
    return function iconOf(item: VaultItemSummary) {
        const row = item.slug ? resolved.get(item.slug) : undefined
        if (row) return <Icon {...serviceIconProps(row.icon, row.category)} size="sm" />
        return <Icon icon={item.kind === 'secret' ? KeyIcon : ServerIcon} size="sm" />
    }
}

const titleOf = (item: VaultItemSummary) => (item.label ? `${item.name} · ${item.label}` : item.name)

export function VaultBadge() {
    const t = useTranslations('agent.agentPanelServices')
    return (
        <Badge size="xs" tone="neutral" glow={false}>
            {t('vaultBadge')}
        </Badge>
    )
}

// The custom servers and secrets the coworker gets from the Vault, as rows of its installed list
// (its catalog apps already come through its registry).
export function CoworkerVaultAttachedRows({ vault, busy, change, disabledReason }: Rows) {
    const t = useTranslations('agent.agentPanelServices')
    const iconOf = useVaultIcons(vault?.attached ?? [])
    if (!vault) return null
    return (
        <>
            {vault.attached.map(item => (
                <PanelRow
                    key={item.id}
                    leading={iconOf(item)}
                    title={
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{titleOf(item)}</span>
                            <VaultBadge />
                        </span>
                    }
                    description={item.kind === 'secret' ? item.envKeys.join(', ') : undefined}
                    actions={
                        <TooltipDisabledReason reason={item.sharedWithAll ? t('vaultShared') : disabledReason}>
                            <PanelDeleteButton
                                label={t('vaultRemove', { name: item.name })}
                                disabled={item.sharedWithAll || !!disabledReason || busy === item.id}
                                onClick={() => void change(item, false)}
                                confirmTitle={t('vaultRemoveConfirm', { name: item.name })}
                                confirmDescription={t('vaultRemoveDescription')}
                                confirmLabel={t('vaultRemoveAction')}
                            />
                        </TooltipDisabledReason>
                    }
                />
            ))}
        </>
    )
}

// Every entry of the Vault the coworker does not hold, each one click away.
export function CoworkerVaultAvailable({ vault, busy, change, disabledReason }: Rows) {
    const t = useTranslations('agent.agentPanelServices')
    const iconOf = useVaultIcons(vault?.available ?? [])
    if (!vault || vault.available.length === 0) return null
    const reason = disabledReason ?? (vault.canAttach ? undefined : t('vaultShared'))
    return (
        <PanelSection label={t('fromVault')}>
            <PanelList>
                {vault.available.map(item => (
                    <PanelRow
                        key={item.id}
                        leading={iconOf(item)}
                        title={titleOf(item)}
                        description={item.kind === 'secret' ? item.envKeys.join(', ') : undefined}
                        actions={
                            <TooltipDisabledReason reason={reason}>
                                <Button size="sm" variant="outline" disabled={!!reason || busy === item.id} onClick={() => void change(item, true)}>
                                    {t('vaultAdd')}
                                </Button>
                            </TooltipDisabledReason>
                        }
                    />
                ))}
            </PanelList>
        </PanelSection>
    )
}
