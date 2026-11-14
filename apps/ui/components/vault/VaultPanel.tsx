'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { VaultEntryView, VaultListing } from '@/app/api/_services/vault.service'
import { AddButton } from '@/components/connections/AiProvidersPanel'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { KeyIcon, LockKeyholeIcon, SearchIcon, ServerIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { Badge } from '@rerun/ui/primitives'
import { VaultAddApp, type VaultAddKind } from './VaultAddApp'
import { VaultEmpty } from './VaultEmpty'
import { VaultEntryDetail } from './VaultEntryDetail'
import { AppIcon } from '@/components/apps/PaidAppViews'
import { PaidAccountStatusBadge, VaultPaidAccountDetail } from './VaultPaidAccountDetail'
import type { VaultPaidAccount } from '@/app/api/_services/vault-apps.service'
import type { VaultCatalogApp } from '@/app/api/_services/vault-install.service'
import { VaultAppTile } from './VaultAppTile'
import { VaultCoworkerFaces, type VaultUsage } from './VaultCoworkerFaces'
import { matchesVaultQuery, vaultGroupOf } from './vault-text'

type VaultPage = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'paid'; connectionId: string } | { kind: 'add'; app?: VaultCatalogApp; addKind?: VaultAddKind }

// Past this many entries the list gets a search field: a handful is read at a glance.
const SEARCH_FROM = 8

type Props = {
    listing: VaultListing | null
    paid?: VaultPaidAccount[]
    error: string | null
    onChanged: () => Promise<void>
    // The lab has no session to read the catalog with.
    loadPopularApps?: () => Promise<VaultCatalogApp[]>
}

export function VaultPanel({ listing, paid = [], error, onChanged, loadPopularApps }: Props) {
    const t = useTranslations('vault')
    const [page, setPage] = useState<VaultPage>({ kind: 'list' })
    const [query, setQuery] = useState('')
    // Kept here rather than in the empty state, which unmounts on every trip to the Add page.
    const [popularApps, setPopularApps] = useState<VaultCatalogApp[] | null>(null)

    // Derived rather than synced: an entry deleted here, or gone on a reload, drops the panel back to the list.
    const selected = page.kind === 'detail' ? listing?.entries.find(entry => entry.id === page.id) : undefined
    const selectedPaid = page.kind === 'paid' ? paid.find(account => account.connectionId === page.connectionId) : undefined
    const stepKey = page.kind === 'add' ? 'add' : (selected?.id ?? selectedPaid?.connectionId ?? 'list')
    const back = () => setPage({ kind: 'list' })

    const slugs = useMemo(() => [...new Set((listing?.entries ?? []).flatMap(entry => (entry.slug ? [entry.slug] : [])))], [listing])
    const { resolved: catalog } = useCatalogServices(slugs)
    const iconOf = (entry: VaultEntryView, size: 'sm' | 'md' = 'sm') => {
        const row = entry.slug ? catalog.get(entry.slug) : undefined
        if (row) return <Icon {...serviceIconProps(row.icon, row.category)} size={size} />
        return <Icon icon={entry.kind === 'secret' ? KeyIcon : ServerIcon} size={size} />
    }

    const addReason = listing && !listing.canAdd ? t('reasons.manageAny') : undefined
    const empty = listing?.entries.length === 0 && paid.length === 0

    return (
        <>
            <DialogHeaderBar
                icon={LockKeyholeIcon}
                title={t('title')}
                description={t('description')}
                actions={
                    stepKey === 'list' &&
                    listing &&
                    !empty && (
                        <TooltipDisabledReason reason={addReason}>
                            <AddButton label={t('add')} disabled={!!addReason} onClick={() => setPage({ kind: 'add' })} />
                        </TooltipDisabledReason>
                    )
                }
            />
            <div className="flex min-h-0 flex-1 flex-col">
                <PanelSteps stepKey={stepKey} depth={stepKey === 'list' ? 0 : 1}>
                    {page.kind === 'add' && listing ? (
                        <VaultAddApp
                            listing={listing}
                            initialApp={page.app}
                            initialKind={page.addKind}
                            onBack={back}
                            onAdded={async id => {
                                await onChanged()
                                setPage({ kind: 'detail', id })
                            }}
                        />
                    ) : selectedPaid && listing ? (
                        <VaultPaidAccountDetail account={selectedPaid} listing={listing} onBack={back} onChanged={onChanged} />
                    ) : selected && listing ? (
                        <VaultEntryDetail entry={selected} listing={listing} icon={iconOf(selected)} onBack={back} onChanged={onChanged} />
                    ) : !listing ? (
                        error ? <p className="p-4 text-sm text-muted-foreground">{error}</p> : <VaultSkeleton />
                    ) : empty ? (
                        <PanelScroller className="flex flex-col p-4">
                            <VaultEmpty addReason={addReason} apps={popularApps} onApps={setPopularApps} loadApps={loadPopularApps} onPick={app => setPage({ kind: 'add', app })} onAdd={addKind => setPage({ kind: 'add', addKind })} />
                        </PanelScroller>
                    ) : (
                        <PanelScroller className="space-y-4 p-4">
                            {listing.entries.length >= SEARCH_FROM && (
                                <div className="relative">
                                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                    <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')} className="pl-8" aria-label={t('search')} />
                                </div>
                            )}
                            <VaultGroups listing={listing} paid={paid} query={query} iconOf={iconOf} onOpen={id => setPage({ kind: 'detail', id })} onOpenPaid={connectionId => setPage({ kind: 'paid', connectionId })} />
                        </PanelScroller>
                    )}
                </PanelSteps>
            </div>
        </>
    )
}

type VaultGroupsProps = {
    listing: VaultListing
    paid: VaultPaidAccount[]
    onOpenPaid: (connectionId: string) => void
    query: string
    iconOf: (entry: VaultEntryView, size?: 'sm' | 'md') => React.ReactNode
    onOpen: (id: string) => void
}

// The apps as tiles, recognised by their logo; the MCP servers and the secrets, which have none, as rows below.
function VaultGroups({ listing, paid, query, iconOf, onOpen, onOpenPaid }: VaultGroupsProps) {
    const t = useTranslations('vault')
    const shown = listing.entries.filter(entry => matchesVaultQuery(entry, query))
    const shownPaid = paid.filter(account => [account.name, account.label ?? ''].some(text => text.toLowerCase().includes(query.trim().toLowerCase())))
    const coworkerName = new Map(listing.coworkers.map(coworker => [coworker.id, coworker.name]))
    if (shown.length === 0 && shownPaid.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('noMatch')}</p>

    const apps = shown.filter(entry => vaultGroupOf(entry) === 'apps')
    const others = shown.filter(entry => vaultGroupOf(entry) !== 'apps')

    return (
        <>
            {(apps.length > 0 || shownPaid.length > 0) && (
                <div className="@container">
                    <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
                        {apps.map(entry => (
                            <VaultAppTile key={entry.id} icon={iconOf(entry, 'md')} name={entry.name} label={entry.label} badges={<VaultStatusBadge entry={entry} />} usage={entry} onClick={() => onOpen(entry.id)} />
                        ))}
                        {shownPaid.map(account => (
                            <VaultAppTile
                                key={account.connectionId}
                                icon={<AppIcon slug={account.slug} size="md" />}
                                name={account.name}
                                label={account.label}
                                badges={
                                    <>
                                        <Badge size="xs" tone="brand" glow={false}>
                                            {t('paid.badge')}
                                        </Badge>
                                        <PaidAccountStatusBadge account={account} />
                                    </>
                                }
                                usage={paidUsage(account, coworkerName)}
                                onClick={() => onOpenPaid(account.connectionId)}
                            />
                        ))}
                    </div>
                </div>
            )}
            {others.length > 0 && (
                <div className="space-y-1.5">
                    {others.map(entry => (
                        <PanelRow
                            key={entry.id}
                            onClick={() => onOpen(entry.id)}
                            leading={iconOf(entry)}
                            title={entry.label ? `${entry.name} · ${entry.label}` : entry.name}
                            description={entry.kind === 'mcp' ? t('addPage.mcp') : t('addPage.secret')}
                            actions={
                                <>
                                    <VaultStatusBadge entry={entry} />
                                    <VaultCoworkerFaces usage={entry} />
                                </>
                            }
                        />
                    ))}
                </div>
            )}
        </>
    )
}

// A paid account names its coworkers by their hub id; the ones the reader cannot see are only counted.
function paidUsage(account: VaultPaidAccount, coworkerName: Map<string, string>): VaultUsage {
    const seen = account.agentIds.filter(id => coworkerName.has(id))
    return {
        sharedWithAll: false,
        coworkers: seen.map(id => ({ id, engineAgentId: id, name: coworkerName.get(id) as string, spaceId: '' })),
        hiddenCoworkers: account.hiddenAgents + account.agentIds.length - seen.length,
    }
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
        <div className="space-y-4 p-4">
            <div className="@container">
                <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="flex flex-col gap-3 rounded-md border p-3">
                            <Skeleton className="size-10 rounded-lg" />
                            <div className="space-y-1.5">
                                <Skeleton className="h-3.5 w-20" />
                                <Skeleton className="h-2.5 w-28 max-w-full" />
                            </div>
                            <Skeleton className="h-6 w-14" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-2.5 w-20" />
                </div>
            </div>
        </div>
    )
}
