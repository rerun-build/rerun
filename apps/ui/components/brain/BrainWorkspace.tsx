'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { listWorkspaceTablesAction } from '@/app/api/_actions/workspace-db.actions'
import { deleteBrainPageAction, listBrainProposalsAction, loadBrainAction, readBrainPageAction, revertBrainPageAction, type BrainOverview } from '@/app/api/_actions/brain.actions'
import { BrainFileView, BrainFolderView } from '@/components/brain/BrainFiles'
import { BrainNewPage } from '@/components/brain/BrainNewPage'
import { BrainPage } from '@/components/brain/BrainPage'
import { BrainPageHistory } from '@/components/brain/BrainPageHistory'
import { PageColumn } from '@/components/brain/BrainPageParts'
import { BrainProposalsPanel } from '@/components/brain/BrainProposalsPanel'
import { BrainPublishedView } from '@/components/brain/BrainPublishedView'
import { BrainSeedForm } from '@/components/brain/BrainSeedForm'
import { BrainSidebar } from '@/components/brain/BrainSidebar'
import { BrainChromeContext, BrainTopBar } from '@/components/brain/BrainTopBar'
import { selectionDepth, selectionKey, type BrainSelection } from '@/components/brain/selection'
import { useSharedFilesTree } from '@/components/brain/useSharedFilesTree'
import { SharedDataPanel, useSharedTablesEmpty } from '@/components/data/SharedDataPanel'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton, SkeletonList } from '@/components/ui/skeleton'
import { UploadTray } from '@/components/ui/upload-tray'
import { pendingBrainSave } from '@/hooks/useBrainAutosave'
import { usePanelUploads } from '@/hooks/usePanelUploads'
import { tablesOrThrow, type DataFocus } from '@/lib/data/source'
import { humanizeTableName } from '@/lib/data/table-name'
import type { BrainPageDetail } from '@/lib/engine/client'
import type { EngineDbTable } from '@/lib/engine/types'
import type { UploadEntry } from '@/lib/files/upload'
import { BrainIcon, DatabaseIcon, RefreshCwIcon, TableIcon } from '@/lib/icons'
import { useBrainStore } from '@/stores/brain.store'
import type { BrainPageSummary, BrainProposal } from '@rerun/contracts'
import { useIsMobile } from '@rerun/ui/primitives/use-is-mobile'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

// What the rest of the app asks the Brain to open on: a page, a section, a table of the database.
export type BrainRequest = { selection: BrainSelection | null; data: DataFocus | null }

type PageState = { slug: string; detail: BrainPageDetail | null; missing: boolean; version: number }

// A read that failed outright, the machine down or the network gone, rather than a box that answered.
type Overview = BrainOverview | { available: false; reason: 'unreachable' }

const UNREACHABLE: Overview = { available: false, reason: 'unreachable' }

function PageSkeleton() {
    return (
        <>
            <div className="flex h-12 shrink-0 items-center px-4">
                <Skeleton className="h-3 w-40" />
            </div>
            <PageColumn>
                <Skeleton className="mb-4 size-12 rounded-xl" />
                <Skeleton className="h-8 w-1/2" />
                <div className="mt-6 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                </div>
                <div className="mt-10 space-y-3">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-2/3" />
                </div>
            </PageColumn>
        </>
    )
}

const toSummary = ({ slug, title, type, hash, updatedAt, updatedBy }: BrainPageDetail['page']): BrainPageSummary => ({ slug, title, type, hash, updatedAt, updatedBy })

// The Brain as one workspace: a sidebar holding everything the company shares with its agents, and
// whatever is selected in it, open in the main panel.
export function BrainWorkspace({ request, publishedEnabled, onRequestConsumed, onClose }: { request: BrainRequest | null; publishedEnabled: boolean; onRequestConsumed: () => void; onClose: () => void }) {
    const t = useTranslations('brain')
    const errorText = useErrorText()
    const sharedTablesEmpty = useSharedTablesEmpty()
    const setOpenProposals = useBrainStore(s => s.setOpenProposals)
    const isMobile = useIsMobile()
    const [overview, setOverview] = useState<Overview | null>(null)
    const [proposals, setProposals] = useState<BrainProposal[] | null>(null)
    const [selection, setSelection] = useState<BrainSelection | null>(null)
    const [pageState, setPageState] = useState<PageState | null>(null)
    const [dataFocus, setDataFocus] = useState<DataFocus | null>(null)
    const [tables, setTables] = useState<EngineDbTable[] | null>(null)
    const [tablesError, setTablesError] = useState<string | null>(null)
    const [seeding, setSeeding] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [uploadDir, setUploadDir] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)
    const focusSearchOnOpenRef = useRef(false)
    const selectionRef = useRef(selection)
    useEffect(() => {
        selectionRef.current = selection
    })
    const files = useSharedFilesTree()

    const pages = useMemo(() => (overview?.available ? overview.pages : []), [overview])
    const titles = useMemo(() => new Map(pages.map(page => [page.slug, page.title])), [pages])

    const reloadOverview = useCallback(async (): Promise<Overview> => {
        const next = await loadBrainAction().catch(() => UNREACHABLE)
        setOverview(next)
        if (next.available) setOpenProposals(next.openProposals)
        return next
    }, [setOpenProposals])

    const reloadTables = useCallback(async () => {
        try {
            const list = tablesOrThrow(await listWorkspaceTablesAction())
            setTables(list)
            setTablesError(null)
            return list
        } catch (err) {
            setTables([])
            setTablesError(err instanceof Error && err.message ? err.message : t('workspace.unreachableFallback'))
            return []
        }
    }, [t])

    const reloadProposals = useCallback(async () => {
        const list = await listBrainProposalsAction().catch(() => [])
        setProposals(list)
        setOpenProposals(list.length)
    }, [setOpenProposals])

    // Two quick clicks fire two reads, and the later-resolving one would otherwise win.
    const readSeq = useRef(0)
    const loadPage = useCallback(async (slug: string) => {
        const seq = ++readSeq.current
        setPageState(current => (current?.slug === slug ? current : { slug, detail: null, missing: false, version: 0 }))
        await pendingBrainSave(slug)
        const detail = await readBrainPageAction(slug)
        if (seq !== readSeq.current) return
        setPageState(current => ({ slug, detail, missing: !detail, version: (current?.slug === slug ? current.version : 0) + 1 }))
    }, [])

    const select = useCallback(
        (next: BrainSelection) => {
            if (next.kind === 'page' && selectionRef.current?.kind === 'page' && selectionRef.current.slug === next.slug) {
                setSidebarOpen(false)
                return
            }
            setSelection(next)
            setSidebarOpen(false)
            if (next.kind === 'page') void loadPage(next.slug)
        },
        [loadPage],
    )

    const consumeRequest = useCallback(
        (incoming: BrainRequest) => {
            setDataFocus(incoming.data)
            if (incoming.data?.table) select({ kind: 'table', name: incoming.data.table })
            else if (incoming.selection && (incoming.selection.kind !== 'published' || publishedEnabled)) select(incoming.selection)
            onRequestConsumed()
        },
        [select, onRequestConsumed, publishedEnabled],
    )

    // A request made before mount is the first selection; one made while open replaces the current.
    const mountRequest = useRef(request)
    const loadWorkspace = useCallback(() => {
        void reloadTables()
        return reloadOverview().then(next => {
            if (next.available) void reloadProposals()
            if (selectionRef.current) return next
            if (next.available && next.pages[0]) select({ kind: 'page', slug: next.pages[0].slug })
            else if (!next.available && next.reason === 'outdated') select({ kind: 'folder', path: '' })
            return next
        })
    }, [reloadTables, reloadOverview, reloadProposals, select])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadWorkspace()
        if (mountRequest.current) consumeRequest(mountRequest.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!request || request === mountRequest.current) return
        consumeRequest(request)
    }, [request, consumeRequest])

    // The Rerun agent wrote the brain from its chat while this was open. The open page only reloads
    // if it is the one that changed, so a page nobody touched keeps its caret.
    const brainVersion = useBrainStore(s => s.version)
    const seenBrainVersion = useRef(brainVersion)
    const pageStateRef = useRef(pageState)
    useEffect(() => {
        pageStateRef.current = pageState
    })
    useEffect(() => {
        if (brainVersion === seenBrainVersion.current) return
        seenBrainVersion.current = brainVersion
        void reloadOverview().then(next => {
            if (next.available) void reloadProposals()
        })
        const open = pageStateRef.current
        if (!open?.detail) return
        const seq = ++readSeq.current
        void readBrainPageAction(open.slug).then(detail => {
            if (seq !== readSeq.current || detail?.page.hash === open.detail?.page.hash) return
            setPageState(current => (current?.slug === open.slug ? { slug: open.slug, detail, missing: !detail, version: current.version + 1 } : current))
        })
    }, [brainVersion, reloadOverview, reloadProposals])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key?.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
            // The agent chat under the dialog also listens for ⌘K, to open a new conversation.
            event.preventDefault()
            event.stopPropagation()
            setSidebarOpen(true)
            // On a phone the sidebar is a Sheet, not mounted until it opens: the search takes the focus once it is there.
            if (!searchRef.current) focusSearchOnOpenRef.current = true
            searchRef.current?.focus()
            searchRef.current?.select()
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [])

    const uploads = usePanelUploads({
        target: useMemo(() => ({ kind: 'shared' }) as const, []),
        currentPath: uploadDir,
        onDirectoryChanged: path => void files.refresh(path),
    })

    const upload = useCallback(
        (entries: UploadEntry[], dir: string) => {
            setUploadDir(dir)
            uploads.enqueue(entries, dir)
        },
        [uploads],
    )

    const openPage = useCallback((slug: string) => select({ kind: 'page', slug }), [select])
    const openFile = useCallback((path: string) => select({ kind: 'file', path }), [select])

    const savedPage = useCallback((detail: BrainPageDetail) => {
        setPageState(current => (current?.slug === detail.page.slug ? { ...current, detail, missing: false } : current))
        setOverview(current => {
            if (!current?.available) return current
            const summary = toSummary(detail.page)
            const known = current.pages.some(page => page.slug === summary.slug)
            return { ...current, pages: known ? current.pages.map(page => (page.slug === summary.slug ? summary : page)) : [...current.pages, summary] }
        })
    }, [])

    const createdPage = useCallback(
        (detail: BrainPageDetail) => {
            savedPage(detail)
            setPageState({ slug: detail.page.slug, detail, missing: false, version: 1 })
            setSelection({ kind: 'page', slug: detail.page.slug })
            void reloadOverview()
        },
        [savedPage, reloadOverview],
    )

    const deletePage = useCallback(
        async (slug: string) => {
            const result = await deleteBrainPageAction(slug)
            if (!result.ok) {
                toast.error(errorText(result, t('workspace.deleteFailed')))
                return
            }
            const next = await reloadOverview()
            const fallback = next.available ? next.pages[0]?.slug : undefined
            if (fallback) select({ kind: 'page', slug: fallback })
            else {
                setSelection(null)
                setPageState(null)
            }
        },
        [reloadOverview, select, t, errorText],
    )

    const restore = useCallback(
        async (slug: string, revisionId: string) => {
            const result = await revertBrainPageAction(slug, revisionId)
            if (!result.ok) {
                toast.error(errorText(result))
                return
            }
            setPageState(current => ({ slug, detail: result.detail, missing: false, version: (current?.version ?? 0) + 1 }))
            setSelection({ kind: 'page', slug })
            void reloadOverview()
        },
        [reloadOverview, errorText],
    )

    const tableDropped = useCallback(
        async (name: string) => {
            const remaining = await reloadTables()
            const next = remaining.find(table => table.name !== name)
            select(next ? { kind: 'table', name: next.name } : { kind: 'database' })
        },
        [reloadTables, select],
    )

    // The database on its own has nothing to show but its first table, once the tables are listed.
    useEffect(() => {
        if (selection?.kind !== 'database' || !tables?.[0]) return
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelection({ kind: 'table', name: tables[0].name })
    }, [selection, tables])

    const proposalDecided = useCallback(
        (proposal: BrainProposal, decision: 'accept' | 'dismiss') => {
            setProposals(current => {
                const remaining = (current ?? []).filter(item => item.id !== proposal.id)
                setOpenProposals(remaining.length)
                return remaining
            })
            if (decision === 'accept') void reloadOverview()
        },
        [reloadOverview, setOpenProposals],
    )

    // Without a machine, or with one that does not answer, there is no page, file or table to list:
    // the sidebar goes and the main panel says why.
    const offline = overview && !overview.available && overview.reason !== 'outdated' ? overview.reason : null

    const chrome = useMemo(() => ({ onClose, onToggleSidebar: isMobile && !offline ? () => setSidebarOpen(true) : null }), [onClose, isMobile, offline])

    const available = overview?.available ?? false
    const noPagesYet = available && pages.length === 0

    const renderMain = () => {
        if (!overview) return <PageSkeleton />

        if (offline) {
            return (
                <>
                    <BrainTopBar crumbs={[{ label: t('crumbs.brain'), icon: BrainIcon }]} />
                    {offline === 'no_machine' ? (
                        <EmptyState
                            icon={BrainIcon}
                            title={t('workspace.noMachineTitle')}
                            description={t('workspace.noMachineDescription')}
                        />
                    ) : (
                        <EmptyState
                            icon={BrainIcon}
                            title={t('workspace.unreachableTitle')}
                            description={t('workspace.unreachableDescription')}
                            action={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        void files.refresh('')
                                        void loadWorkspace().then(next => {
                                            const current = selectionRef.current
                                            if (next.available && current?.kind === 'page') void loadPage(current.slug)
                                        })
                                    }}
                                >
                                    <RefreshCwIcon className="size-3.5" /> {t('workspace.retry')}
                                </Button>
                            }
                        />
                    )}
                </>
            )
        }

        if (!selection) {
            if (noPagesYet) {
                return (
                    <>
                        <BrainTopBar crumbs={[{ label: t('crumbs.company') }]} />
                        <EmptyState
                            icon={BrainIcon}
                            title={seeding ? t('workspace.seedingTitle') : t('workspace.emptyTitle')}
                            description={
                                seeding ? t('workspace.seedingDescription') : t('workspace.emptyDescription')
                            }
                            action={
                                seeding ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            void reloadOverview().then(next => {
                                                if (next.available && next.pages[0]) select({ kind: 'page', slug: next.pages[0].slug })
                                            })
                                        }
                                    >
                                        <RefreshCwIcon className="size-3.5" /> {t('workspace.refresh')}
                                    </Button>
                                ) : (
                                    <div className="flex flex-col items-center gap-3">
                                        <BrainSeedForm onStarted={() => setSeeding(true)} />
                                        <Button size="sm" variant="ghost" onClick={() => select({ kind: 'new-page' })}>
                                            {t('workspace.writeYourself')}
                                        </Button>
                                    </div>
                                )
                            }
                        />
                    </>
                )
            }
            return <BrainTopBar crumbs={[{ label: t('crumbs.brain'), icon: BrainIcon }]} />
        }

        switch (selection.kind) {
            case 'page': {
                if (pageState?.slug !== selection.slug || (!pageState.detail && !pageState.missing)) return <PageSkeleton />
                if (!pageState.detail) {
                    return (
                        <>
                            <BrainTopBar crumbs={[{ label: t('crumbs.pages') }, { label: selection.slug }]} />
                            <EmptyState icon={BrainIcon} title={t('workspace.missingPageTitle', { slug: selection.slug })} description={t('workspace.missingPageDescription')} />
                        </>
                    )
                }
                const detail = pageState.detail
                return (
                    <BrainPage
                        key={`${detail.page.slug}:${pageState.version}`}
                        detail={detail}
                        pages={pages}
                        titles={titles}
                        files={files.knownFiles}
                        proposal={proposals?.find(proposal => proposal.slug === detail.page.slug && proposal.mode === 'edit') ?? null}
                        onOpenPage={openPage}
                        onOpenFile={openFile}
                        onReviewProposals={() => select({ kind: 'proposals' })}
                        onSaved={savedPage}
                        onHistory={() => setSelection({ kind: 'history', slug: detail.page.slug })}
                        onDelete={() => deletePage(detail.page.slug)}
                    />
                )
            }
            case 'history': {
                const detail = pageState?.slug === selection.slug ? pageState.detail : null
                if (!detail) return <PageSkeleton />
                return (
                    <BrainPageHistory
                        page={detail.page}
                        revisions={detail.revisions}
                        titles={titles}
                        onBack={() => setSelection({ kind: 'page', slug: selection.slug })}
                        onOpenPage={openPage}
                        onOpenFile={openFile}
                        onRestore={revisionId => restore(selection.slug, revisionId)}
                    />
                )
            }
            case 'new-page':
                return <BrainNewPage pages={pages} titles={titles} files={files.knownFiles} onOpenPage={openPage} onOpenFile={openFile} onCreated={createdPage} />
            case 'proposals':
                return <BrainProposalsPanel proposals={available ? proposals : []} onDecided={proposalDecided} onOpenPage={openPage} />
            case 'published':
                return <BrainPublishedView />
            case 'folder':
                return <BrainFolderView path={selection.path} files={files} onSelect={select} onUpload={upload} />
            case 'file':
                return <BrainFileView path={selection.path} files={files} onSelect={select} />
            case 'database':
                if (!tables || tables.length > 0) return <PageSkeleton />
                return (
                    <>
                        <BrainTopBar crumbs={[{ label: t('crumbs.database'), icon: DatabaseIcon }]} />
                        {tablesError ? (
                            <EmptyState icon={DatabaseIcon} title={t('workspace.databaseUnavailable')} description={tablesError} />
                        ) : (
                            <EmptyState icon={DatabaseIcon} title={sharedTablesEmpty.title} description={sharedTablesEmpty.description} />
                        )}
                    </>
                )
            case 'table': {
                const name = selection.name
                const crumbs = [
                    { label: t('crumbs.database'), icon: DatabaseIcon },
                    { label: humanizeTableName(name), icon: TableIcon },
                ]
                if (tables && !tables.some(table => table.name === name)) {
                    return (
                        <>
                            <BrainTopBar crumbs={crumbs} />
                            <EmptyState icon={TableIcon} title={t('workspace.missingTableTitle', { name })} description={t('workspace.missingTableDescription')} />
                        </>
                    )
                }
                return (
                    <>
                        <BrainTopBar crumbs={crumbs} />
                        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
                            <SharedDataPanel
                                key={name}
                                table={name}
                                initial={dataFocus?.table === name ? dataFocus : null}
                                onInitialConsumed={() => setDataFocus(null)}
                                onTableDropped={() => void tableDropped(name)}
                            />
                        </div>
                    </>
                )
            }
        }
    }

    const sidebar = overview ? (
        <BrainSidebar
            pages={pages}
            pagesAvailable={available}
            selection={selection}
            openProposals={proposals?.length ?? (overview.available ? overview.openProposals : 0)}
            publishedEnabled={publishedEnabled}
            files={files}
            tables={tables}
            searchRef={searchRef}
            onSelect={select}
            onUpload={upload}
        />
    ) : (
        <div className="space-y-3 p-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-7 w-full" />
            <SkeletonList rows={8} />
        </div>
    )

    return (
        <BrainChromeContext.Provider value={chrome}>
            <div data-brain-workspace className="relative flex min-h-0 flex-1">
                {!offline &&
                    (isMobile ? (
                        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                            <SheetContent
                                side="left"
                                showCloseButton={false}
                                aria-describedby={undefined}
                                onOpenAutoFocus={event => {
                                    event.preventDefault()
                                    if (!focusSearchOnOpenRef.current) return
                                    focusSearchOnOpenRef.current = false
                                    searchRef.current?.focus()
                                    searchRef.current?.select()
                                }}
                                className="gap-0 p-0 data-[side=left]:w-[85%] data-[side=left]:max-w-[300px]"
                            >
                                <SheetTitle className="sr-only">{t('sidebar.title')}</SheetTitle>
                                {sidebar}
                            </SheetContent>
                        </Sheet>
                    ) : (
                        <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-muted/30">{sidebar}</aside>
                    ))}

                <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
                    <PanelSteps stepKey={selectionKey(selection)} depth={selectionDepth(selection)}>
                        {renderMain()}
                    </PanelSteps>
                </main>

                <UploadTray items={uploads.items} totalProgress={uploads.totalProgress} onCancel={uploads.cancel} onRetry={uploads.retry} onDismiss={uploads.active ? uploads.cancelAll : uploads.clearFinished} />
            </div>
        </BrainChromeContext.Provider>
    )
}

