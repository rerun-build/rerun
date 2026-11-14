'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { vaultPopularAppsAction } from '@/app/api/_actions/vault.actions'
import type { VaultCatalogApp } from '@/app/api/_services/vault-install.service'
import { AddButton } from '@/components/connections/AiProvidersPanel'
import { Icon } from '@/components/ui/icon'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { LockIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'
import type { VaultAddKind } from './VaultAddApp'

const POPULAR_SHOWN = 6

type Props = {
    addReason?: string
    // Null until they are read; the panel holds them so a trip to the Add page does not read them again.
    apps: VaultCatalogApp[] | null
    onApps: (apps: VaultCatalogApp[]) => void
    loadApps?: () => Promise<VaultCatalogApp[]>
    onPick: (app: VaultCatalogApp) => void
    onAdd: (kind: VaultAddKind) => void
}

async function readPopularApps(): Promise<VaultCatalogApp[]> {
    const res = await vaultPopularAppsAction()
    return res.ok ? res.result : []
}

// An empty Vault offers the apps people add first, one click each, rather than a sentence about them.
export function VaultEmpty({ addReason, apps, onApps, loadApps = readPopularApps, onPick, onAdd }: Props) {
    const t = useTranslations('vault')
    const loaded = apps !== null

    useEffect(() => {
        if (loaded) return
        let cancelled = false
        void loadApps().then(result => {
            if (!cancelled) onApps(result)
        })
        return () => {
            cancelled = true
        }
    }, [loaded, loadApps, onApps])

    return (
        <div className="my-auto flex flex-col items-center gap-5 py-4 text-center">
            <Icon icon={LockIcon} size="xl" />
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            {apps?.length !== 0 && (
                <div className="grid w-full max-w-sm grid-cols-3 gap-2">
                    {apps === null
                        ? Array.from({ length: POPULAR_SHOWN }, (_, i) => (
                              <div key={i} className="flex flex-col items-center gap-2 rounded-md border p-3">
                                  <Skeleton className="size-8 rounded-lg" />
                                  <Skeleton className="h-3 w-14" />
                              </div>
                          ))
                        : apps.slice(0, POPULAR_SHOWN).map(app => (
                              <TooltipDisabledReason key={app.slug} reason={addReason} className="flex">
                                  <button type="button" disabled={!!addReason} onClick={() => onPick(app)} className={cn(PANEL_CARD, PANEL_CARD_INTERACTIVE, 'flex w-full min-w-0 flex-col items-center gap-2 p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60')}>
                                      <Icon {...serviceIconProps(app.icon, app.category)} size="sm" />
                                      <span className="w-full truncate text-xs">{app.name}</span>
                                  </button>
                              </TooltipDisabledReason>
                          ))}
                </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
                {(['app', 'mcp', 'secret'] as const).map(kind => (
                    <TooltipDisabledReason key={kind} reason={addReason}>
                        <AddButton label={kind === 'app' ? t('otherApp') : t(kind === 'mcp' ? 'addPage.mcp' : 'addPage.secret')} disabled={!!addReason} onClick={() => onAdd(kind)} />
                    </TooltipDisabledReason>
                ))}
            </div>
        </div>
    )
}
