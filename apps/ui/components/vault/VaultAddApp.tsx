'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { vaultCatalogAction } from '@/app/api/_actions/vault.actions'
import type { VaultCatalogApp } from '@/app/api/_services/vault-install.service'
import type { VaultListing } from '@/app/api/_services/vault.service'
import { ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { ServiceSetupDriverProvider } from '@/components/services/service-setup-driver'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelEditorHeader } from '@/components/ui/panel-editor'
import { PanelRow } from '@/components/ui/panel-row'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorText } from '@/hooks/useErrorText'
import { ChevronRightIcon, SearchIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { Segmented } from '@/components/ui/segmented'
import { vaultSetupDriver } from './vault-setup-driver'
import { VaultAddMcp, VaultAddSecret } from './VaultAddOther'

type AddKind = 'app' | 'mcp' | 'secret'

const SEARCH_DELAY_MS = 250

// Adding an app to the Vault: pick it in the catalog, then sign in or type its key once. Who uses it is
// picked next, on the entry itself.
export function VaultAddApp({ listing, onBack, onAdded }: { listing: VaultListing; onBack: () => void; onAdded: (itemId: string) => Promise<void> }) {
    const t = useTranslations('vault')
    const [picked, setPicked] = useState<VaultCatalogApp | null>(null)
    const [kind, setKind] = useState<AddKind>('app')

    return (
        <PanelSteps stepKey={picked?.slug ?? 'catalog'} depth={picked ? 1 : 0}>
            {picked ? (
                <VaultAppSetup app={picked} listing={listing} onBack={() => setPicked(null)} onAdded={onAdded} />
            ) : (
                <div className="flex h-full flex-col">
                    <PanelEditorHeader title={t('addPage.title')} onBack={onBack} />
                    <div className="border-b px-3 pt-3">
                        <Segmented
                            className="mb-3 w-full"
                            value={kind}
                            onChange={setKind}
                            options={[
                                { value: 'app', label: t('groups.apps') },
                                { value: 'mcp', label: t('addPage.mcp') },
                                { value: 'secret', label: t('addPage.secret') },
                            ]}
                        />
                    </div>
                    {kind === 'app' ? (
                        <VaultCatalog onPick={setPicked} />
                    ) : (
                        <PanelScroller className="p-4">{kind === 'mcp' ? <VaultAddMcp onAdded={onAdded} /> : <VaultAddSecret onAdded={onAdded} />}</PanelScroller>
                    )}
                </div>
            )}
        </PanelSteps>
    )
}

function VaultCatalog({ onPick }: { onPick: (app: VaultCatalogApp) => void }) {
    const t = useTranslations('vault')
    const errorText = useErrorText()
    const [query, setQuery] = useState('')
    const [apps, setApps] = useState<VaultCatalogApp[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        const timer = setTimeout(
            () =>
                void vaultCatalogAction(query).then(res => {
                    if (cancelled) return
                    if (res.ok) {
                        setApps(res.result)
                        setError(null)
                    } else setError(errorText(res))
                }),
            query ? SEARCH_DELAY_MS : 0,
        )
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [query, errorText])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b p-3">
                <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('addPage.search')} className="pl-8" aria-label={t('addPage.search')} />
                </div>
            </div>
            <PanelScroller className="space-y-1.5 p-3">
                {error ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>
                ) : apps === null ? (
                    Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                            <Skeleton className="size-8 rounded-md" />
                            <div className="flex-1 space-y-1.5">
                                <Skeleton className="h-3.5 w-24" />
                                <Skeleton className="h-2.5 w-48" />
                            </div>
                        </div>
                    ))
                ) : apps.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
                ) : (
                    apps.map(app => (
                        <PanelRow
                            key={app.slug}
                            onClick={() => onPick(app)}
                            leading={<Icon {...serviceIconProps(app.icon, app.category)} size="sm" />}
                            title={app.name}
                            description={app.summary}
                            actions={<ChevronRightIcon className="size-4 text-muted-foreground" />}
                        />
                    ))
                )}
            </PanelScroller>
        </div>
    )
}

function VaultAppSetup({ app, listing, onBack, onAdded }: { app: VaultCatalogApp; listing: VaultListing; onBack: () => void; onAdded: (itemId: string) => Promise<void> }) {
    // One driver for the life of the form: it carries the entry the first submit created, which the
    // form then reports as the key it installed.
    const driver = useMemo(() => vaultSetupDriver({ itemId: null, agentIds: [], onItem: () => {} }, app.name), [app.name])
    const sameApp = listing.entries.filter(entry => entry.slug === app.slug).length

    return (
        <div className="flex h-full flex-col">
            <PanelEditorHeader title={sameApp > 0 && app.multiInstance ? `${app.name} ${sameApp + 1}` : app.name} onBack={onBack} />
            <PanelScroller className="p-4">
                <ServiceSetupDriverProvider value={driver}>
                    <ServiceConfigForm
                        vault
                        agentId=""
                        slug={app.slug}
                        name={app.name}
                        authMethods={app.authMethods}
                        onInstalled={key => void onAdded(key)}
                    />
                </ServiceSetupDriverProvider>
            </PanelScroller>
        </div>
    )
}
