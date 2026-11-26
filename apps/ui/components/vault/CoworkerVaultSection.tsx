'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { AppsHeading } from '@/components/agent/AppTiles'
import { attachVaultEntryAction, coworkerVaultAction, detachVaultEntryAction } from '@/app/api/_actions/vault.actions'
import type { CoworkerVault } from '@/app/api/_services/vault.service'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelList } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { useErrorText } from '@/hooks/useErrorText'
import { KeyIcon, ServerIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { vaultAccountLabel, type VaultItemSummary } from '@rerun/contracts'

type Change = (item: VaultItemSummary, attach: boolean) => Promise<void>

// The coworker's side of the Vault, read with the tab and again each time its list changes.
export function useCoworkerVault(agentId: string, revision: number, onChanged: () => Promise<void>, onError: (message: string) => void) {
    const t = useTranslations('agent.agentPanelServices')
    const errorText = useErrorText()
    const [vault, setVault] = useState<CoworkerVault | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    const read = useCallback(async () => setVault(await coworkerVaultAction(agentId)), [agentId])
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void read()
    }, [read, revision])

    const change: Change = async (item, attach) => {
        setBusy(item.id)
        const res = attach ? await attachVaultEntryAction(item.id, agentId) : await detachVaultEntryAction(item.id, agentId)
        if (!res.ok) onError(errorText(res, t('vaultAttachFailed', { name: item.name })))
        await Promise.all([read(), onChanged()])
        setBusy(null)
    }

    return { vault, busy, change }
}

type AvailableProps = { items: VaultItemSummary[]; canAttach: boolean; busy: string | null; change: Change; disabledReason?: string }

export function useVaultIcons(items: VaultItemSummary[]) {
    const slugs = useMemo(() => [...new Set(items.flatMap(item => (item.slug ? [item.slug] : [])))], [items])
    const { resolved } = useCatalogServices(slugs)
    return function iconOf(item: VaultItemSummary) {
        const row = item.slug ? resolved.get(item.slug) : undefined
        if (row) return <Icon {...serviceIconProps(row.icon, row.category)} size="sm" />
        return <Icon icon={item.kind === 'secret' ? KeyIcon : ServerIcon} size="sm" />
    }
}

// The entries of the Vault the coworker does not hold (already filtered by the search), each one
// click away.
export function CoworkerVaultAvailable({ items, canAttach, busy, change, disabledReason }: AvailableProps) {
    const t = useTranslations('agent.agentPanelServices')
    const iconOf = useVaultIcons(items)
    if (items.length === 0) return null
    const reason = disabledReason ?? (canAttach ? undefined : t('vaultShared'))
    return (
        <section>
            <AppsHeading title={t('vault')} count={items.length} />
            <PanelList>
                {items.map(item => (
                    <PanelRow
                        key={item.id}
                        leading={iconOf(item)}
                        title={item.name}
                        description={item.kind === 'secret' ? item.envKeys.join(', ') : vaultAccountLabel(item)}
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
        </section>
    )
}
