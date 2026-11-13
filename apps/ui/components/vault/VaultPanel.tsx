'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { VaultEntryView, VaultListing } from '@/app/api/_services/vault.service'
import { AddButton, EmptyPitch, Group } from '@/components/connections/AiProvidersPanel'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { ChevronRightIcon, KeyIcon, SearchIcon, ServerIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { Badge } from '@rerun/ui/primitives'
import { VaultAddApp } from './VaultAddApp'
import { VaultEntryDetail } from './VaultEntryDetail'
import { matchesVaultQuery, usedBySummary, vaultGroupOf, type UsedByText, type VaultGroup } from './vault-text'

type VaultPage = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'add' }

// Past this many entries the list gets a search field: a handful is read at a glance.
const SEARCH_FROM = 8
const GROUPS: VaultGroup[] = ['apps', 'mcp', 'secrets']

export function VaultPanel({ listing, error, onChanged }: { listing: VaultListing | null; error: string | null; onChanged: () => Promise<void> }) {
    const t = useTranslations('vault')
    const [page, setPage] = useState<VaultPage>({ kind: 'list' })
    const [query, setQuery] = useState('')

    // Derived rather than synced: an entry deleted here, or gone on a reload, drops the panel back to the list.
    const selected = page.kind === 'detail' ? listing?.entries.find(entry => entry.id === page.id) : undefined
    const stepKey = page.kind === 'add' ? 'add' : (selected?.id ?? 'list')
    const back = () => setPage({ kind: 'list' })

    const slugs = useMemo(() => [...new Set((listing?.entries ?? []).flatMap(entry => (entry.slug ? [entry.slug] : [])))], [listing])
    const { resolved: catalog } = useCatalogServices(slugs)
    const iconOf = (entry: VaultEntryView) => {
        const row = entry.slug ? catalog.get(entry.slug) : undefined
        if (row) return <Icon {...serviceIconProps(row.icon, row.category)} size="sm" />
        return <Icon icon={entry.kind === 'secret' ? KeyIcon : ServerIcon} size="sm" />
    }

    const addReason = listing && !listing.canAdd ? t('reasons.manageAny') : undefined

    return (
        <PanelSteps stepKey={stepKey} depth={stepKey === 'list' ? 0 : 1}>
            {page.kind === 'add' && listing ? (
                <VaultAddApp
                    listing={listing}
                    onBack={back}
                    onAdded={async id => {
                        await onChanged()
                        setPage({ kind: 'detail', id })
                    }}
                />
            ) : selected && listing ? (
                <VaultEntryDetail entry={selected} listing={listing} icon={iconOf(selected)} onBack={back} onChanged={onChanged} />
            ) : !listing ? (
                error ? <p className="p-4 text-sm text-muted-foreground">{error}</p> : <VaultSkeleton />
            ) : (
                <PanelScroller className="space-y-6 p-4">
                    {listing.entries.length >= SEARCH_FROM && (
                        <div className="relative">
                            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')} className="pl-8" aria-label={t('search')} />
                        </div>
                    )}
                    {listing.entries.length === 0 ? (
                        <EmptyPitch
                            text={t('empty')}
                            actions={
                                <TooltipDisabledReason reason={addReason}>
                                    <Button variant="outline" disabled={!!addReason} onClick={() => setPage({ kind: 'add' })}>
                                        {t('addApp')}
                                    </Button>
                                </TooltipDisabledReason>
                            }
                        />
                    ) : (
                        <VaultGroups listing={listing} query={query} iconOf={iconOf} onOpen={id => setPage({ kind: 'detail', id })} onAdd={() => setPage({ kind: 'add' })} addReason={addReason} />
                    )}
                </PanelScroller>
            )}
        </PanelSteps>
    )
}

type VaultGroupsProps = {
    listing: VaultListing
    query: string
    iconOf: (entry: VaultEntryView) => React.ReactNode
    onOpen: (id: string) => void
    onAdd: () => void
    addReason?: string
}

function VaultGroups({ listing, query, iconOf, onOpen, onAdd, addReason }: VaultGroupsProps) {
    const t = useTranslations('vault')
    const usedByText: UsedByText = {
        everyone: t('row.everyone'),
        unused: t('row.unused'),
        usedBy: names => t('row.usedBy', { names }),
        usedByMore: (names, count) => t('row.usedByMore', { names, count }),
        hidden: count => t('detail.hiddenCoworkers', { count }),
    }
    const groupTitle: Record<VaultGroup, string> = { apps: t('groups.apps'), mcp: t('groups.mcp'), secrets: t('groups.secrets') }
    const shown = listing.entries.filter(entry => matchesVaultQuery(entry, query))
    if (shown.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('noMatch')}</p>

    const addMenu = (
        <TooltipDisabledReason reason={addReason}>
            <AddButton label={t('add')} disabled={!!addReason} onClick={onAdd} />
        </TooltipDisabledReason>
    )

    return (
        <>
            {GROUPS.map((group, index) => {
                const entries = shown.filter(entry => vaultGroupOf(entry) === group)
                if (entries.length === 0 && group !== 'apps') return null
                return (
                    <Group key={group} title={groupTitle[group]} addMenu={group === 'apps' || index === 0 ? addMenu : undefined}>
                        {entries.map(entry => (
                            <PanelRow
                                key={entry.id}
                                onClick={() => onOpen(entry.id)}
                                leading={iconOf(entry)}
                                title={entry.label ? `${entry.name} · ${entry.label}` : entry.name}
                                description={usedBySummary(entry, usedByText)}
                                actions={
                                    <>
                                        <VaultStatusBadge entry={entry} />
                                        <ChevronRightIcon className="ml-1 size-4 text-muted-foreground" />
                                    </>
                                }
                            />
                        ))}
                    </Group>
                )
            })}
        </>
    )
}

export function VaultStatusBadge({ entry }: { entry: Pick<VaultEntryView, 'status'> }) {
    const t = useTranslations('vault')
    if (entry.status === 'needs_auth')
        return (
            <Badge size="xs" tone="orange" glow={false}>
                {t('status.needsAuth')}
            </Badge>
        )
    if (entry.status === 'needs_config')
        return (
            <Badge size="xs" tone="neutral" glow={false}>
                {t('status.needsConfig')}
            </Badge>
        )
    return null
}

function VaultSkeleton() {
    return (
        <div className="space-y-6 p-4">
            {[3, 1].map((rows, group) => (
                <div key={group} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    {Array.from({ length: rows }, (_, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                            <Skeleton className="size-8 rounded-md" />
                            <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-28" />
                                <Skeleton className="h-2.5 w-40" />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}
