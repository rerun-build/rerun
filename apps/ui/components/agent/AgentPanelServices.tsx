'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useLoadMoreOnScroll } from '@/hooks/useLoadMoreOnScroll'
import { parseServiceRegistryKey } from '@rerun/contracts'

import { getServiceAlternativesAction, getServiceDetailsAction, installServiceAction, listCatalogServicesAction, resetServiceConnectionAction, searchServicesAction, uninstallServiceAction } from '@/app/api/_actions/services.actions'
import { getAgentDetailAction, patchAgentMcpServersAction } from '@/app/api/_actions/agent.actions'
import { listAgentConnectorsAction, removeCustomMcpServerAction } from '@/app/api/_actions/custom-mcp.actions'
import { McpOAuthAuthorize } from '@/components/agent/McpOAuthAuthorize'
import { McpServerEditor } from '@/components/agent/McpServerEditor'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { setConnectorServices } from '@/hooks/useConnectorServices'
import { refreshMcpServerStatuses, useMcpServerStatuses } from '@/hooks/useMcpServerStatuses'
import type { EngineMcpServer } from '@/lib/engine/types'
import { PanelEditorBody, PanelEditorHeader, PanelEditorShell } from '@/components/ui/panel-editor'
import { PanelSteps } from '@/components/ui/panel-steps'
import { RequestConnectorDialog } from '@/components/services/RequestConnectorDialog'
import { ServiceAlternatives } from '@/components/services/ServiceAlternatives'
import { ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { ServiceList } from '@/components/services/ServiceList'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { useCanManageAgent } from '@/hooks/useBoxAccess'
import { useBoxManageReason } from '@/hooks/useBoxManageReason'
import { serviceIconProps } from '@/lib/services/icons'
import { MAX_OFFERED_ALTERNATIVES } from '@/lib/services/alternatives'
import type { AppTarget, AuthMethodSummary, ComposioTarget, CustomMcpServer, InstalledService, ManagedTarget, OAuthTarget, ServiceAlternative, ServiceDetails, ServiceSearchResult } from '@/lib/services/types'
import { Loader2Icon, ServerIcon } from '@/lib/icons'
import { PanelScroller } from '@/components/ui/panel-list'
import { SkeletonPanelRows } from '@/components/ui/skeleton'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CoworkerVaultAvailable, useCoworkerVault, useVaultIcons } from '@/components/vault/CoworkerVaultSection'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { AppTileCard, AppsHeading, TILE_GRID, TileSkeletons, type TileHandlers } from '@/components/agent/AppTiles'
import { type AppTile, groupTiles, takenSlugs, tileMatches, toTiles, vaultEntryMatches } from '@/components/agent/apps-tab'
import { usePaidAppsStore } from '@/stores/paid-apps.store'

type AgentPanelServicesProps = {
    agentId: string
}

type AuthTargets = { oauth?: OAuthTarget; managed?: ManagedTarget; composio?: ComposioTarget; app?: AppTarget }

type SetupTarget = {
    slug: string
    // The account being set up; absent while a new account has not been allocated yet.
    key?: string
    newInstance?: boolean
    name: string
    category: string
    icon: string | null
    authMethods: AuthMethodSummary[]
    initialMethodId?: string
    initialAuthTarget?: AuthTargets
    alternatives: ServiceAlternative[]
}

// A custom server is edited where it is listed, with the same editor as the MCP tab. The sign-in
// window opens inside the Connect click, before anything is fetched, or the browser blocks it.
type CustomStep = { kind: 'connect'; server: CustomMcpServer; popup: Window | null } | { kind: 'edit'; server: EngineMcpServer }

function pendingAuthTarget(targets: AuthTargets): AuthTargets | undefined {
    return targets.oauth || targets.managed || targets.composio || targets.app ? { oauth: targets.oauth, managed: targets.managed, composio: targets.composio, app: targets.app } : undefined
}

function toSetupTarget(details: ServiceDetails, icon: string | null, alternatives: ServiceAlternative[]): SetupTarget {
    return {
        slug: details.slug,
        key: details.key,
        name: details.name,
        category: details.category,
        icon,
        authMethods: details.authMethods,
        initialMethodId: details.installedMethodId,
        initialAuthTarget: details.installStatus === 'needs_auth' ? pendingAuthTarget(details) : undefined,
        alternatives,
    }
}

type Confirm = { title: string; description: string; label: string; onConfirm: () => Promise<void> }

// Browse page size for the paginated catalog. Matches the server default; a full page back
// means there may be more, so infinite scroll keeps going.
const BROWSE_PAGE_SIZE = 60

// Services tab: browse the library and manage installed services. Reuses the exact
// same ServiceConfigForm shown inline in chat, so config is identical on both sides.
export function AgentPanelServices({ agentId }: AgentPanelServicesProps) {
    const boxManageReason = useBoxManageReason(agentId)
    const t = useTranslations('agent.agentPanelServices')
    const tServices = useTranslations('services')
    const tMcp = useTranslations('services.customMcp')
    const errorText = useErrorText()
    const [installed, setInstalled] = useState<InstalledService[]>([])
    const [custom, setCustom] = useState<CustomMcpServer[]>([])
    const [customStep, setCustomStep] = useState<CustomStep | null>(null)
    const { statuses: customStatuses } = useMcpServerStatuses(agentId)
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [loading, setLoading] = useState(true)
    const [setupTarget, setSetupTarget] = useState<SetupTarget | null>(null)
    const [swapping, setSwapping] = useState<string | null>(null)
    const [swapError, setSwapError] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [reconnecting, setReconnecting] = useState<string | null>(null)
    const [confirm, setConfirm] = useState<Confirm | null>(null)
    // Bumped after every change of the list, so the Vault section below reads its own state again.
    const [revision, setRevision] = useState(0)
    const canManage = useCanManageAgent(agentId)
    const manageReason = canManage ? undefined : boxManageReason

    // Paginated browse accumulation (empty query). A ref tracks server rows fetched so
    // client-side dedup can't drift the offset, and a ref guard blocks the concurrent calls a
    // fast scroll or observer re-fire would otherwise make.
    const [browseServices, setBrowseServices] = useState<ServiceSearchResult[]>([])
    const [browseHasMore, setBrowseHasMore] = useState(true)
    const [browseLoading, setBrowseLoading] = useState(false)
    const browseOffsetRef = useRef(0)
    const browseLoadingRef = useRef(false)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    // Ranked search results (non-empty query) — bounded, flat, no infinite scroll.
    const [searchResults, setSearchResults] = useState<ServiceSearchResult[]>([])
    const [searching, setSearching] = useState(false)

    const isSearchActive = query.trim().length > 0
    // True while a query is typed but its results aren't ready yet — covers both the debounce
    // window and the in-flight semantic search, so the skeleton shows immediately.
    const searchLoading = isSearchActive && (searching || query.trim() !== debouncedQuery.trim())

    // Semantic search embeds the query, so debounce keystrokes to avoid one call each.
    useEffect(() => {
        const id = setTimeout(() => setDebouncedQuery(query), 300)
        return () => clearTimeout(id)
    }, [query])

    const loadMoreBrowse = useCallback(async () => {
        if (browseLoadingRef.current || !browseHasMore) return
        browseLoadingRef.current = true
        setBrowseLoading(true)
        const offset = browseOffsetRef.current
        const page = await listCatalogServicesAction({ limit: BROWSE_PAGE_SIZE, offset })
        browseOffsetRef.current = offset + page.length
        setBrowseServices(prev => {
            const seen = new Set(prev.map(s => s.slug))
            return [...prev, ...page.filter(s => !seen.has(s.slug))]
        })
        setBrowseHasMore(page.length === BROWSE_PAGE_SIZE)
        setBrowseLoading(false)
        browseLoadingRef.current = false
    }, [browseHasMore])

    const resetBrowse = useCallback(() => {
        browseOffsetRef.current = 0
        setBrowseServices([])
        setBrowseHasMore(true)
    }, [])

    // Reload the installed section and re-seed the first browse page. Called on mount and after
    // any (un)install, so an app that was just added leaves the library.
    const load = useCallback(async () => {
        setLoading(true)
        const { services, custom: customServers } = await listAgentConnectorsAction(agentId)
        setInstalled(services)
        setCustom(customServers)
        resetBrowse()
        setLoading(false)
        setRevision(r => r + 1)
        setConnectorServices(agentId, services, customServers)
    }, [agentId, resetBrowse])

    // A paid app's account reconnected or signed out in its own window moves the status of its tile.
    const paidAppsRevision = usePaidAppsStore(s => s.revision)
    useEffect(() => {
        load()
    }, [load, paidAppsRevision])

    const coworkerVault = useCoworkerVault(agentId, revision, load, setError)

    // Seed the first browse page once the initial load has cleared it.
    useEffect(() => {
        if (isSearchActive) return
        if (browseServices.length === 0) loadMoreBrowse()
    }, [isSearchActive, browseServices.length, loadMoreBrowse])

    // Run the ranked search when a query is active; annulable so a stale response can't clobber
    // a newer one.
    useEffect(() => {
        const q = debouncedQuery.trim()
        if (!q) {
            setSearchResults([])
            setSearching(false)
            return
        }
        let active = true
        setSearching(true)
        searchServicesAction(agentId, q).then(results => {
            if (!active) return
            setSearchResults(results)
            setSearching(false)
        })
        return () => {
            active = false
        }
    }, [agentId, debouncedQuery])

    const onInstall = useCallback(
        async (key: string, authTarget?: AuthTargets) => {
            const { slug } = parseServiceRegistryKey(key)
            const [details, alternatives] = await Promise.all([getServiceDetailsAction(agentId, key), getServiceAlternativesAction([slug])])
            if (!details) return
            const icon = [...installed, ...browseServices, ...searchResults].find(s => s.slug === slug)?.icon ?? null
            const target = { ...toSetupTarget(details, icon, alternatives[slug] ?? []), ...(authTarget ? { initialAuthTarget: authTarget } : {}) }
            setSwapError(null)
            // Already compiled and only waiting on the sign-in → the form opens straight on
            // Connect rather than recompiling the service to rediscover a target we already hold.
            if (target.initialAuthTarget) {
                setSetupTarget(target)
                return
            }
            // A single method with no fields → install straight away (OAuth sign-in or
            // skill-only); an OAuth method then returns needs_auth → open the connect step.
            // Anything with fields or a choice of methods → open the config form.
            const single = details.authMethods.length === 1 ? details.authMethods[0] : null
            if (single && single.inputs.length === 0) {
                const res = await installServiceAction(agentId, key, {}, single.id)
                if (res.ok && res.result.status === 'needs_auth') {
                    setSetupTarget({ ...target, initialAuthTarget: pendingAuthTarget(res.result) })
                    return
                }
                await load()
                return
            }
            setSetupTarget(target)
        },
        [agentId, load, installed, browseServices, searchResults],
    )

    // Clear the stored sign-in, then hand over to onInstall: the entry now reads needs_auth, so
    // it lands straight on Connect without recompiling anything. A paid app still bound to an
    // account stays active, so its picker is opened explicitly.
    const onReconnect = useCallback(
        async (key: string) => {
            setError(null)
            setReconnecting(key)
            const res = await resetServiceConnectionAction(agentId, key)
            setReconnecting(null)
            if (!res.ok) {
                setError(errorText(res))
                return
            }
            await onInstall(key, res.result.mode === 'auth' && res.result.app ? { app: res.result.app } : undefined)
            await load()
        },
        [agentId, onInstall, load, errorText],
    )

    // Same shortcut as onInstall, except the install allocates a fresh account instead of
    // reopening the one the coworker already holds.
    const onAddAccount = useCallback(
        async (slug: string) => {
            const details = await getServiceDetailsAction(agentId, slug)
            if (!details) return
            // The accounts of a paid app share one connector: another one is ticked in its picker.
            if (details.authMethods.some(method => method.kind === 'app')) return onReconnect(slug)
            const icon = [...installed, ...browseServices, ...searchResults].find(s => s.slug === slug)?.icon ?? null
            const target: SetupTarget = { ...toSetupTarget(details, icon, []), key: undefined, newInstance: true, initialAuthTarget: undefined }
            setSwapError(null)
            const single = details.authMethods.length === 1 ? details.authMethods[0] : null
            if (single && single.inputs.length === 0) {
                const res = await installServiceAction(agentId, slug, {}, single.id, { newInstance: true })
                if (res.ok && res.result.status === 'needs_auth') {
                    setSetupTarget({ ...target, key: res.result.key, newInstance: false, initialAuthTarget: pendingAuthTarget(res.result) })
                    return
                }
                if (!res.ok) setError(errorText(res))
                await load()
                return
            }
            setSetupTarget(target)
        },
        [agentId, load, installed, browseServices, searchResults, errorText, onReconnect],
    )

    const onUninstall = useCallback(
        async (key: string) => {
            setError(null)
            const res = await uninstallServiceAction(agentId, key)
            if (!res.success) setError(errorText(res, t('uninstallFailed')))
            await load()
        },
        [agentId, load, t, errorText],
    )

    const afterCustomChange = useCallback(async () => {
        setCustomStep(null)
        refreshMcpServerStatuses(agentId)
        await load()
    }, [agentId, load])

    const onRemoveCustom = useCallback(
        async (name: string) => {
            setError(null)
            const res = await removeCustomMcpServerAction(agentId, name)
            if (!res.success) setError(errorText(res, t('removeServerFailed')))
            await afterCustomChange()
        },
        [agentId, afterCustomChange, t, errorText],
    )

    const onEditCustom = useCallback(
        async (name: string) => {
            setError(null)
            const server = (await getAgentDetailAction(agentId))?.config.mcpServers?.find(s => s.name === name)
            if (server) setCustomStep({ kind: 'edit', server: server as EngineMcpServer })
            else setError(t('loadServerFailed'))
        },
        [agentId, t],
    )

    const swapTo = async (alternative: ServiceAlternative) => {
        if (!setupTarget || swapping) return
        setSwapping(alternative.slug)
        setSwapError(null)
        const details = await getServiceDetailsAction(agentId, alternative.slug)
        setSwapping(null)
        if (!details || details.authMethods.length === 0) {
            setSwapError(t('alternativeLoadFailed', { name: alternative.name }))
            return
        }
        const current: ServiceAlternative = { slug: setupTarget.slug, name: setupTarget.name, category: setupTarget.category, icon: setupTarget.icon }
        setSetupTarget(toSetupTarget(details, alternative.icon, [current, ...setupTarget.alternatives.filter(a => a.slug !== alternative.slug)].slice(0, MAX_OFFERED_ALTERNATIVES)))
    }

    const tiles = useMemo(() => toTiles(installed, custom, customStatuses, coworkerVault.vault?.attached ?? []), [installed, custom, customStatuses, coworkerVault.vault])
    const vaultAvailable = useMemo(() => coworkerVault.vault?.available ?? [], [coworkerVault.vault])
    const taken = useMemo(() => takenSlugs(tiles, vaultAvailable), [tiles, vaultAvailable])
    // Results still on screen while a new query is typed belong to the previous one.
    const foundSlugs = useMemo(() => new Set(searchLoading ? [] : searchResults.map(s => s.slug)), [searchLoading, searchResults])
    const { resolved: catalogRows } = useCatalogServices([...new Set(installed.map(s => s.slug))])
    const vaultIconOf = useVaultIcons(coworkerVault.vault?.attached ?? [])

    useLoadMoreOnScroll({ sentinelRef, enabled: !isSearchActive && browseHasMore, loaded: browseServices.length, loadMore: loadMoreBrowse })

    const tileHandlers: TileHandlers = {
        onSignIn: tile => {
            // A paid app's accounts are picked, and a signed-out one is reconnected, in its account picker.
            if (tile.kind === 'app') void (tile.service.app ? onReconnect(tile.key) : onInstall(tile.key))
            // The sign-in window opens inside the click, before anything is fetched, or the browser blocks it.
            if (tile.kind === 'mcp') setCustomStep({ kind: 'connect', server: tile.server, popup: openPendingSignInPopup(tile.server.displayName, tServices('signInPopup.connecting', { name: tile.server.displayName })) })
        },
        onReconnect: tile => void onReconnect(tile.key),
        onEdit: tile => {
            if (tile.kind === 'mcp') void onEditCustom(tile.server.name)
        },
        onAddAccount: slug => void onAddAccount(slug),
        onRemove: tile => {
            if (tile.kind === 'mcp') {
                setConfirm({ title: tMcp('removeTitle', { name: tile.name }), description: tMcp('removeDescription'), label: tMcp('removeConfirm'), onConfirm: () => onRemoveCustom(tile.server.name) })
            } else if (tile.kind === 'vault') {
                setConfirm({ title: t('vaultRemoveConfirm', { name: tile.name }), description: t('vaultRemoveDescription'), label: t('vaultRemoveAction'), onConfirm: () => coworkerVault.change(tile.item, false) })
            } else if (tile.service.vault) {
                // Lent by the Vault: removing it only detaches this coworker.
                setConfirm({ title: t('vaultRemoveConfirm', { name: tile.account ? `${tile.name} · ${tile.account}` : tile.name }), description: t('vaultRemoveDescription'), label: t('vaultRemoveAction'), onConfirm: () => onUninstall(tile.key) })
            } else {
                setConfirm({
                    title: tile.account ? t('uninstallLabeledConfirm', { name: tile.name, label: tile.account }) : t('uninstallConfirm', { name: tile.name }),
                    description: t('uninstallDescription'),
                    label: t('uninstallAction'),
                    onConfirm: () => onUninstall(tile.key),
                })
            }
        },
    }

    const iconOf = (tile: AppTile) => {
        if (tile.kind === 'app') return <Icon {...serviceIconProps(tile.service.icon, tile.service.category)} size="sm" />
        if (tile.kind === 'vault') return vaultIconOf(tile.item)
        return tile.server.icon ? <Icon {...serviceIconProps(tile.server.icon, 'custom')} size="sm" /> : <Icon icon={ServerIcon} size="sm" />
    }
    // A paid app takes its other accounts in its own picker (its Account item), never as a new install.
    const canAddAccount = (tile: AppTile) => {
        const row = tile.kind === 'app' ? catalogRows.get(tile.slug ?? '') : undefined
        return !!row?.multiInstance && !row.paidApp
    }
    const isBusy = (tile: AppTile) => (tile.kind === 'vault' ? coworkerVault.busy === tile.item.id : reconnecting === tile.key)

    const signInUrl = customStep?.kind === 'connect' ? customStep.server.signInUrl : null
    if (customStep?.kind === 'connect' && signInUrl) {
        const { server, popup } = customStep
        return (
            <PanelSteps stepKey={`connect:${server.name}`} depth={1}>
                <PanelEditorShell>
                    <PanelEditorHeader title={server.displayName} onBack={() => setCustomStep(null)} />
                    <PanelEditorBody>
                        <p className="text-xs text-muted-foreground">{t('signInHint', { host: server.host ?? server.displayName })}</p>
                        <McpOAuthAuthorize url={signInUrl} agentId={agentId} serverName={server.name} autoStart pendingPopup={popup} onAuthorized={afterCustomChange} />
                    </PanelEditorBody>
                </PanelEditorShell>
            </PanelSteps>
        )
    }

    if (customStep?.kind === 'edit') {
        const current = customStep.server
        return (
            <PanelSteps stepKey={`edit:${current.name}`} depth={1}>
                <McpServerEditor
                    agentId={agentId}
                    server={current}
                    onSave={([server]) => patchAgentMcpServersAction(agentId, { remove: current.name !== server.name ? [current.name] : [], upsert: [server] })}
                    onDelete={() => removeCustomMcpServerAction(agentId, current.name)}
                    onDone={afterCustomChange}
                    onBack={() => setCustomStep(null)}
                />
            </PanelSteps>
        )
    }

    if (setupTarget) {
        // An app the agent already runs would only be offered to be set up a second time.
        const alternatives = setupTarget.alternatives.filter(a => !installed.some(s => s.slug === a.slug && s.status === 'active'))
        // Two accounts of one app never share a form's state.
        const setupKey = setupTarget.key ?? `${setupTarget.slug}:new`
        return (
            <PanelSteps stepKey={`setup:${setupKey}`} depth={1}>
                <PanelEditorShell>
                    <PanelEditorHeader
                        title={setupTarget.name}
                        onBack={() => {
                            // A key the app refused leaves the app to configure: the list has changed.
                            setSetupTarget(null)
                            void load()
                        }}
                    />
                    <PanelEditorBody>
                        <ServiceConfigForm
                            key={setupKey}
                            agentId={agentId}
                            slug={setupTarget.slug}
                            instanceKey={setupTarget.key}
                            newInstance={setupTarget.newInstance}
                            name={setupTarget.name}
                            authMethods={setupTarget.authMethods}
                            initialMethodId={setupTarget.initialMethodId}
                            initialAuthTarget={setupTarget.initialAuthTarget}
                            onInstalled={async () => {
                                setSetupTarget(null)
                                await load()
                            }}
                        />
                        <ServiceAlternatives alternatives={alternatives} swapping={swapping} error={swapError} onPick={swapTo} />
                    </PanelEditorBody>
                </PanelEditorShell>
            </PanelSteps>
        )
    }

    const groups = groupTiles(tiles.filter(tile => tileMatches(query, tile, foundSlugs)))
    const shownVault = vaultAvailable.filter(item => vaultEntryMatches(query, item, foundSlugs))
    const library = (isSearchActive ? searchResults : browseServices).filter(s => !taken.has(s.slug))
    const nothing = isSearchActive && !searchLoading && groups.length + shownVault.length + library.length === 0
    const showRequest = isSearchActive ? !searchLoading && library.length === 0 : !browseHasMore
    const initialLoading = loading || (!isSearchActive && browseServices.length === 0 && browseHasMore)

    return (
        <PanelSteps stepKey="list" depth={0}>
            <div className="flex h-full flex-col">
                <div className="border-b border-border p-3">
                    <Input value={query} placeholder={t('searchPlaceholder')} className="h-8 text-sm" onChange={e => setQuery(e.target.value)} />
                </div>
                <PanelScroller className="space-y-5">
                    {error && <p className="text-xs text-destructive">{error}</p>}
                    {initialLoading ? (
                        <TileSkeletons />
                    ) : (
                        <>
                            {nothing && <p className="py-8 text-center text-xs text-muted-foreground">{t('noMatch', { query: query.trim() })}</p>}
                            {groups.length > 0 && (
                                <section>
                                    <AppsHeading title={t('installed')} count={groups.length} />
                                    <div className={TILE_GRID}>
                                        {groups.map(group => (
                                            <AppTileCard
                                                key={group[0].key}
                                                tiles={group}
                                                icon={iconOf(group[0])}
                                                canAddAccount={canAddAccount(group[0])}
                                                busy={group.some(isBusy)}
                                                readOnlyReason={manageReason}
                                                handlers={tileHandlers}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                            <CoworkerVaultAvailable items={shownVault} canAttach={!!coworkerVault.vault?.canAttach} busy={coworkerVault.busy} change={coworkerVault.change} disabledReason={manageReason} />
                            {searchLoading ? (
                                <SkeletonPanelRows rows={6} leading className="p-0" />
                            ) : (
                                library.length > 0 && (
                                    <section>
                                        <AppsHeading title={t('library')} count={isSearchActive || !browseHasMore ? library.length : undefined} hint={t('libraryHint')} />
                                        <ServiceList services={library} onInstall={onInstall} disabledReason={manageReason} />
                                    </section>
                                )
                            )}
                            {!isSearchActive && (
                                <>
                                    <div ref={sentinelRef} className="h-px" />
                                    {browseLoading && (
                                        <div className="flex justify-center py-2">
                                            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                                        </div>
                                    )}
                                </>
                            )}
                            {showRequest && (
                                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-6 text-center">
                                    <p className="text-xs text-muted-foreground">{t('requestHint')}</p>
                                    <RequestConnectorDialog agentId={agentId}>
                                        <Button size="sm" variant="outline">
                                            {t('requestApp')}
                                        </Button>
                                    </RequestConnectorDialog>
                                </div>
                            )}
                        </>
                    )}
                </PanelScroller>
            </div>
            {confirm && (
                <ConfirmDialog
                    open
                    onOpenChange={open => !open && setConfirm(null)}
                    title={confirm.title}
                    description={confirm.description}
                    confirmLabel={confirm.label}
                    onConfirm={() => {
                        const { onConfirm } = confirm
                        setConfirm(null)
                        void onConfirm()
                    }}
                />
            )}
        </PanelSteps>
    )
}
