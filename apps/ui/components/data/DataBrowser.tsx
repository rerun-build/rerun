'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { DeleteTableDialog } from '@/components/dialogs/DeleteTableDialog'
import { PurgeTableDialog } from '@/components/dialogs/PurgeTableDialog'
import { ViewSettingsDialog } from '@/components/dialogs/ViewSettingsDialog'
import { DataBrowserPagination } from '@/components/data/DataBrowserPagination'
import { DataBrowserTable, rowKey, type DbRow } from '@/components/data/DataBrowserTable'
import { DataBrowserToolbar } from '@/components/data/DataBrowserToolbar'
import { DataViewBar } from '@/components/data/DataViewBar'
import { LeadSourcesSheet } from '@/components/data/sources/LeadSourcesSheet'
import { showsSourcesColumn } from '@/components/data/sources/table-sources'
import { useTableSources } from '@/components/data/sources/useTableSources'
import { ViewBoard } from '@/components/data/views/ViewBoard'
import { ViewGallery } from '@/components/data/views/ViewGallery'
import { ViewList } from '@/components/data/views/ViewList'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton'
import { friendlyColumns, gridColumns } from '@/lib/data/friendly-columns'
import type { DataFocus, DataSource, SqlValue } from '@/lib/data/source'
import { humanizeTableName } from '@/lib/data/table-name'
import { quickViewInput } from '@/lib/data/view-form'
import { ALL_ROWS, coerceCellInput, findView, readLastView, writeLastView } from '@/lib/data/views'
import type { EngineDbRows, EngineDbTable } from '@/lib/engine/types'
import { CheckIcon, ChevronDownIcon, DatabaseIcon, TableIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { CardLayout, TableView } from '@rerun/contracts'
import { formatNumber } from '@rerun/i18n/format'
import type { CellContext } from '@rerun/ui/chat'
import { type ColumnDef, type SortingState, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

type DataBrowserProps = {
    source: DataSource
    /** Table, and view, a card in chat asked to land on. Captured at mount and honoured once. */
    initial?: DataFocus | null
    onInitialConsumed?: () => void
    /** Opens the same table and view somewhere larger. */
    onExpand?: (focus: DataFocus) => void
    /** Shows this one table, with no picker: the caller lists the tables itself. */
    table?: string
    onTableDropped?: () => void
}

type ViewDialog = { open: boolean; view?: TableView; layout?: CardLayout }

const NO_ROWS: DbRow[] = []

export function DataBrowser({ source, initial, onInitialConsumed, onExpand, table: pinnedTable, onTableDropped }: DataBrowserProps) {
    const locale = useLocale()
    const t = useTranslations('data.browser')
    const tLayouts = useTranslations('data.layouts')
    const errorText = useErrorText()
    const [requested] = useState(() => initial ?? null)
    const requestedTableRef = useRef(requested?.table ?? null)
    const requestedViewRef = useRef(requested?.view)
    const [tables, setTables] = useState<EngineDbTable[]>([])
    const [selected, setSelected] = useState<string | null>(null)
    const [data, setData] = useState<EngineDbRows | null>(null)
    const [pageIndex, setPageIndex] = useState(0)
    const [pageSize, setPageSize] = useState(25)
    const [sorting, setSorting] = useState<SortingState>([])
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [loadingTables, setLoadingTables] = useState(true)
    const [loadingRows, setLoadingRows] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
    const [refreshKey, setRefreshKey] = useState(0)
    const [tableDialogOpen, setTableDialogOpen] = useState(false)
    const [purgeDialogOpen, setPurgeDialogOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [views, setViews] = useState<TableView[]>([])
    const [viewsError, setViewsError] = useState<string | null>(null)
    // Null until the views of the selected table are in: the rows wait for them, since the view
    // picks their order.
    const [activeId, setActiveId] = useState<string | null>(null)
    const [viewDialog, setViewDialog] = useState<ViewDialog>({ open: false })
    const [addingView, setAddingView] = useState(false)
    // The kind of each column is read from the first page of a table and view, then kept, so a
    // column does not change looks from one page to the next.
    const [kindSample, setKindSample] = useState<{ key: string; rows: DbRow[] } | null>(null)
    const [openRow, setOpenRow] = useState<DbRow | null>(null)

    // Kept out of loadTables' deps: callers pass this callback inline, and a fresh identity on every
    // render would make the effect below refetch forever.
    const consumeRequestedRef = useRef(onInitialConsumed)
    const tableNotFoundRef = useRef(t('tableNotFound'))
    useEffect(() => {
        consumeRequestedRef.current = onInitialConsumed
        tableNotFoundRef.current = t('tableNotFound')
    })

    const loadTables = useCallback(() => {
        setLoadingTables(true)
        setError(null)
        return source
            .listTables()
            .then(result => {
                setTables(result)
                // Consumed here rather than in a setState updater: React double-invokes updaters in
                // development, and this fires a toast and a callback.
                const requestedTable = requestedTableRef.current
                if (requestedTable) {
                    requestedTableRef.current = null
                    consumeRequestedRef.current?.()
                    if (result.some(table => table.name === requestedTable)) {
                        setSelected(requestedTable)
                        return
                    }
                    // Only worth saying when another table opens in its place: an empty database
                    // already shows its own empty state.
                    if (result.length > 0) toast.error(tableNotFoundRef.current, { description: requestedTable })
                }
                setSelected(prev => pinnedTable ?? (prev && result.some(table => table.name === prev) ? prev : (result[0]?.name ?? null)))
            })
            .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : source.unreachableMessage))
            .finally(() => setLoadingTables(false))
    }, [source, pinnedTable])

    useEffect(() => {
        loadTables()
    }, [loadTables])

    useEffect(() => {
        const id = setTimeout(() => setQuery(search.trim()), 300)
        return () => clearTimeout(id)
    }, [search])

    useEffect(() => {
        setPageIndex(0)
        setSearch('')
        setQuery('')
        setSelectedRowIds(new Set())
        setActionError(null)
        setOpenRow(null)
    }, [selected])

    useEffect(() => {
        if (!selected) return
        let cancelled = false
        setActiveId(null)
        source.listViews(selected).then(result => {
            if (cancelled) return
            const list = result.success ? result.views : []
            setViews(list)
            setViewsError(result.success ? null : errorText(result))
            const wanted = requestedViewRef.current
            requestedViewRef.current = undefined
            const remembered = readLastView(source.storageKey, selected)
            const picked = findView(list, wanted) ?? (remembered && remembered !== ALL_ROWS ? findView(list, remembered) : undefined)
            setActiveId(picked?.id ?? (remembered === ALL_ROWS ? ALL_ROWS : (list[0]?.id ?? ALL_ROWS)))
        })
        return () => {
            cancelled = true
        }
    }, [source, selected, errorText])

    const activeView = activeId && activeId !== ALL_ROWS ? views.find(view => view.id === activeId) : undefined
    const boardView = activeView?.layout === 'board' && activeView.groupBy ? (activeView as TableView & { groupBy: string }) : undefined

    // A view brings its own order; a click on a header overrides it until the view changes.
    useEffect(() => {
        setPageIndex(0)
        setSelectedRowIds(new Set())
        setSorting(activeView?.sort ? [{ id: activeView.sort.column, desc: activeView.sort.dir === 'desc' }] : [])
        // A switch of view, or a save that changes its sort, resets the order; a save that keeps it does not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, activeView?.sort?.column, activeView?.sort?.dir])

    useEffect(() => {
        if (!selected || activeId === null) {
            setData(null)
            return
        }
        let cancelled = false
        const sort = sorting[0]
        setLoadingRows(true)
        source
            .readRows(selected, {
                limit: pageSize,
                offset: pageIndex * pageSize,
                sort: sort?.id,
                dir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
                q: query || undefined,
                where: activeView?.where,
            })
            .then(result => {
                if (cancelled) return
                setData(result)
                setLoadingRows(false)
                const sampleKey = `${selected}\u0000${activeId}`
                if (result) setKindSample(current => (current?.key === sampleKey ? current : { key: sampleKey, rows: result.rows as DbRow[] }))
            })
        return () => {
            cancelled = true
        }
    }, [source, selected, activeId, activeView?.where, pageIndex, pageSize, sorting, query, refreshKey])

    const tableMeta = tables.find(table => table.name === selected)
    const allColumns = useMemo(() => tableMeta?.columns.map(c => c.name) ?? [], [tableMeta])
    const sampleRows = kindSample?.key === `${selected}\u0000${activeId}` ? kindSample.rows : undefined
    const friendly = useMemo(() => friendlyColumns(tableMeta?.columns ?? [], sampleRows ?? []), [tableMeta, sampleRows])
    const friendlyByKey = useMemo(() => new Map(friendly.map(column => [column.key, column])), [friendly])
    const viewOrder = activeView?.layout === 'table' && activeView.columns?.length ? activeView.columns : undefined
    const returned = data?.columns
    const shownColumns = useMemo(() => {
        if (viewOrder) return viewOrder
        const ordered = gridColumns(friendly).map(column => column.key)
        // A column the engine returns but the schema we hold does not know yet still shows.
        return returned ? [...ordered.filter(key => returned.includes(key)), ...returned.filter(key => !friendlyByKey.has(key))] : ordered
    }, [viewOrder, friendly, friendlyByKey, returned])

    const columns = useMemo<ColumnDef<DbRow>[]>(
        () =>
            shownColumns.map(col => ({
                id: col,
                accessorKey: col,
                header: col,
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [shownColumns.join('\u0000')],
    )

    const total = data?.total ?? 0
    const rows = useMemo(() => (data?.rows ?? []) as DbRow[], [data?.rows])
    const canSelectRows = rows.length > 0 && rowKey(rows[0]) !== null

    const pageKeys = useMemo(() => rows.map(rowKey).filter((k): k is string => k !== null), [rows])
    const allPageSelected = pageKeys.length > 0 && pageKeys.every(k => selectedRowIds.has(k))

    const cellContext: CellContext = { tones: activeView?.tones, fileUrl: source.fileUrl }

    const { sourcesOf, pending: sourcesPending } = useTableSources(source, selected, rows)
    // A row opened from the board is not on the page the table read, so it is asked about alone.
    const openRowOffPage = openRow !== null && !rows.includes(openRow)
    const openRowAlone = useMemo(() => (openRow && openRowOffPage ? [openRow] : NO_ROWS), [openRow, openRowOffPage])
    const { sourcesOf: sourcesOfOpenRow } = useTableSources(source, selected, openRowAlone)
    const sourcesShown = showsSourcesColumn(rows, sourcesOf)
    // While the next page is being traced, the column stays put rather than blinking out and back.
    const [sourcesColumn, setSourcesColumn] = useState({ table: selected, shown: false })
    if (!sourcesPending && (sourcesColumn.table !== selected || sourcesColumn.shown !== sourcesShown)) setSourcesColumn({ table: selected, shown: sourcesShown })
    const showSources = sourcesShown || (sourcesPending && sourcesColumn.table === selected && sourcesColumn.shown)
    const sheetColumns = useMemo(() => gridColumns(friendly, viewOrder), [friendly, viewOrder])

    const table = useReactTable({
        data: rows,
        columns,
        state: { sorting, pagination: { pageIndex, pageSize } },
        manualSorting: true,
        manualFiltering: true,
        manualPagination: true,
        rowCount: total,
        onSortingChange: setSorting,
        onPaginationChange: updater => {
            const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater
            setPageIndex(next.pageIndex)
            setPageSize(next.pageSize)
        },
        getCoreRowModel: getCoreRowModel(),
    })

    const toggleRow = useCallback((key: string) => {
        setSelectedRowIds(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])

    const toggleAllPage = useCallback(() => {
        setSelectedRowIds(prev => {
            const next = new Set(prev)
            const everySelected = pageKeys.length > 0 && pageKeys.every(k => next.has(k))
            if (everySelected) pageKeys.forEach(k => next.delete(k))
            else pageKeys.forEach(k => next.add(k))
            return next
        })
    }, [pageKeys])

    const deleteRows = useCallback(
        async (ids: (number | string)[]) => {
            if (!selected || ids.length === 0) return
            setBusy(true)
            setActionError(null)
            const result = await source.deleteRows(selected, ids)
            setBusy(false)
            if (!result.success) {
                setActionError(errorText(result, t('deleteRowsFailed')))
                return
            }
            setSelectedRowIds(new Set())
            setPageIndex(0)
            setRefreshKey(k => k + 1)
        },
        [source, selected, t, errorText],
    )

    const saveRow = useCallback(
        async (row: DbRow, values: Record<string, SqlValue>): Promise<DbRow | null> => {
            const id = rowKey(row)
            if (!selected || id === null) return null
            const result = await source.updateRow(selected, id, values)
            if (!result.success) {
                toast.error(t('saveRowFailed'), { description: errorText(result) })
                return null
            }
            setData(current => current && { ...current, rows: current.rows.map(r => (rowKey(r as DbRow) === id ? result.row : r)) })
            return result.row as DbRow
        },
        [source, selected, t, errorText],
    )

    const editCell = useCallback(
        async (row: DbRow, column: string, text: string) => (await saveRow(row, { [column]: coerceCellInput(text, tableMeta?.columns.find(c => c.name === column)) })) !== null,
        [saveRow, tableMeta],
    )

    const confirmDropTable = useCallback(async () => {
        setTableDialogOpen(false)
        if (!selected) return
        setBusy(true)
        setActionError(null)
        const result = await source.dropTable(selected)
        setBusy(false)
        if (!result.success) {
            setActionError(errorText(result, t('deleteTableFailed')))
            return
        }
        if (onTableDropped) onTableDropped()
        else await loadTables()
    }, [source, selected, loadTables, onTableDropped, t, errorText])

    const confirmPurgeTable = useCallback(async () => {
        setPurgeDialogOpen(false)
        if (!selected) return
        setBusy(true)
        setActionError(null)
        const result = await source.purgeTable(selected)
        setBusy(false)
        if (!result.success) {
            setActionError(errorText(result, t('purgeTableFailed')))
            return
        }
        setSelectedRowIds(new Set())
        setPageIndex(0)
        setRefreshKey(k => k + 1)
    }, [source, selected, t, errorText])

    const exportTable = useCallback(
        (format: 'csv' | 'json') => {
            if (!selected) return
            const sort = sorting[0]
            window.open(
                source.exportUrl(selected, {
                    format,
                    sort: sort?.id,
                    dir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
                    q: query || undefined,
                    where: activeView?.where,
                }),
                '_blank',
            )
        },
        [source, selected, sorting, query, activeView?.where],
    )

    const selectView = (id: string) => {
        if (selected) writeLastView(source.storageKey, selected, id)
        setActiveId(id)
    }

    const onViewSaved = (view: TableView) => {
        setViews(current => (current.some(v => v.id === view.id) ? current.map(v => (v.id === view.id ? view : v)) : [...current, view]))
        selectView(view.id)
        setRefreshKey(k => k + 1)
    }

    const addView = async (layout: CardLayout) => {
        if (!selected) return
        const input = quickViewInput(layout, { columns: allColumns, rows, takenNames: views.map(view => view.name), baseName: tLayouts(layout) })
        if (!input) {
            setViewDialog({ open: true, layout })
            return
        }
        setAddingView(true)
        const result = await source.saveView(selected, input)
        setAddingView(false)
        if (!result.success) {
            toast.error(t('addViewFailed'), { description: errorText(result) })
            return
        }
        onViewSaved(result.view)
    }

    const deleteView = async (view: TableView) => {
        if (!selected) return
        const result = await source.deleteView(selected, view.id)
        if (!result.success) {
            toast.error(t('deleteViewFailed'), { description: errorText(result) })
            return
        }
        setViews(current => current.filter(v => v.id !== view.id))
        if (activeId === view.id) selectView(ALL_ROWS)
    }

    if (loadingTables) return <DataBrowserSkeleton />

    if (error) {
        return (
            <EmptyState
                className="h-full"
                icon={DatabaseIcon}
                title={t('unavailable')}
                description={error}
                action={
                    <Button variant="outline" size="sm" onClick={() => void loadTables()}>
                        {t('tryAgain')}
                    </Button>
                }
            />
        )
    }

    if (tables.length === 0) {
        return <EmptyState className="h-full" icon={DatabaseIcon} title={source.emptyTitle} description={source.emptyDescription} />
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col">
            <div className="shrink-0 px-4 pt-5 @3xl:px-12 @3xl:pt-10">
                <span className="hidden size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground @3xl:mb-3 @3xl:inline-flex">
                    <TableIcon className="size-5" />
                </span>
                <div className="flex min-w-0 items-center">
                    {pinnedTable || tables.length < 2 ? (
                        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground @3xl:text-3xl">{humanizeTableName(selected ?? '')}</h1>
                    ) : (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="-ml-2 h-auto min-w-0 gap-1.5 px-2 py-0.5 text-xl font-semibold tracking-tight text-foreground @3xl:text-3xl">
                                    <span className="truncate">{humanizeTableName(selected ?? '')}</span>
                                    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
                                {tables.map(entry => (
                                    <DropdownMenuItem key={entry.name} onSelect={() => setSelected(entry.name)}>
                                        <TableIcon />
                                        <span className="min-w-0 flex-1 truncate">{humanizeTableName(entry.name)}</span>
                                        {selected === entry.name && <CheckIcon />}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{data ? t(query ? 'rowCountFound' : 'rowCount', { count: total, total: formatNumber(total, locale) }) : '\u00a0'}</p>
                {activeId !== null && (
                    <div className="mt-4">
                        <DataViewBar
                            views={views}
                            activeId={activeId}
                            unavailableReason={viewsError ?? undefined}
                            onSelect={selectView}
                            onAdd={addView}
                            adding={addingView}
                            onEdit={view => setViewDialog({ open: true, view })}
                            onDelete={deleteView}
                            onExpand={onExpand && selected ? () => onExpand({ table: selected, view: activeId === ALL_ROWS ? undefined : activeId }) : undefined}
                            actions={
                                <DataBrowserToolbar
                                    search={search}
                                    selectedCount={selectedRowIds.size}
                                    busy={busy}
                                    onSearchChange={value => {
                                        setSearch(value)
                                        setPageIndex(0)
                                    }}
                                    onClearSelection={() => setSelectedRowIds(new Set())}
                                    onDeleteSelected={() => deleteRows(Array.from(selectedRowIds))}
                                    onExport={exportTable}
                                    onPurgeTable={() => setPurgeDialogOpen(true)}
                                    onDropTable={() => setTableDialogOpen(true)}
                                    tableActionsReason={source.tableActionsReason}
                                />
                            }
                        />
                    </div>
                )}
            </div>
            {actionError && <div className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive @3xl:mx-12">{actionError}</div>}
            <div className={cn('min-h-0 flex-1 overflow-auto', !boardView && '@3xl:px-12')}>
                {boardView && selected ? (
                    <ViewBoard source={source} table={selected} view={boardView} query={query} refreshKey={refreshKey} context={cellContext} onOpenRow={setOpenRow} />
                ) : (loadingRows && !data) || activeId === null ? (
                    <SkeletonGrid />
                ) : rows.length === 0 ? (
                    <EmptyState className="h-full" icon={DatabaseIcon} title={t('noRows')} description={search ? t('noSearchMatch') : t('tableEmpty')} />
                ) : activeView?.layout === 'list' ? (
                    <ViewList view={activeView} rows={rows} context={cellContext} onOpenRow={setOpenRow} />
                ) : activeView?.layout === 'gallery' ? (
                    <ViewGallery view={activeView} rows={rows} context={cellContext} onOpenRow={setOpenRow} />
                ) : (
                    <DataBrowserTable
                        table={table}
                        friendly={friendlyByKey}
                        canSelectRows={canSelectRows}
                        allPageSelected={allPageSelected}
                        selectedRowIds={selectedRowIds}
                        onToggleRow={toggleRow}
                        onToggleAllPage={toggleAllPage}
                        formats={activeView?.formats}
                        cellContext={cellContext}
                        onEditCell={editCell}
                        sourcesOf={sourcesOf}
                        showSources={showSources}
                        onOpenSources={setOpenRow}
                    />
                )}
            </div>
            {!boardView && (
                <DataBrowserPagination
                    pageIndex={pageIndex}
                    pageSize={pageSize}
                    shown={rows.length}
                    total={total}
                    onPageSizeChange={size => {
                        setPageSize(size)
                        setPageIndex(0)
                    }}
                    onPageChange={setPageIndex}
                />
            )}
            {selected && (
                <ViewSettingsDialog
                    open={viewDialog.open}
                    onOpenChange={open => setViewDialog(current => ({ ...current, open }))}
                    source={source}
                    table={selected}
                    columns={allColumns}
                    sample={{ rows, total }}
                    view={viewDialog.view}
                    initialLayout={viewDialog.layout}
                    onSaved={onViewSaved}
                />
            )}
            <LeadSourcesSheet
                row={openRow}
                onOpenChange={open => !open && setOpenRow(null)}
                columns={sheetColumns}
                sources={openRowOffPage ? sourcesOfOpenRow(openRow) : sourcesOf(openRow)}
                tones={activeView?.tones}
            />
            <PurgeTableDialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen} onConfirm={confirmPurgeTable} table={selected ?? ''} />
            <DeleteTableDialog open={tableDialogOpen} onOpenChange={setTableDialogOpen} onConfirm={confirmDropTable} table={selected ?? ''} />
        </div>
    )
}

function SkeletonGrid() {
    return (
        <div className="px-4 @3xl:px-0">
            <SkeletonTable rows={10} cols={5} className="[&>div]:h-9 [&>div]:items-center" />
        </div>
    )
}

function DataBrowserSkeleton() {
    return (
        <div className="@container flex h-full flex-col">
            <div className="px-4 pt-5 @3xl:px-12 @3xl:pt-10">
                <Skeleton className="mb-3 hidden size-10 rounded-lg @3xl:block" />
                <Skeleton className="h-6 w-48 @3xl:h-8" />
                <Skeleton className="mt-2 h-3 w-16" />
                <div className="mt-4 flex gap-4 border-b border-border pb-2.5">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                </div>
            </div>
            <div className="@3xl:px-12">
                <SkeletonGrid />
            </div>
        </div>
    )
}
