'use client'

import type { FileEntry } from '@/app/api/_actions/workspace-file.actions'
import { SHARED_FILE_DRAG_TYPE } from '@/components/brain/editor/file-link'
import type { BrainSelection } from '@/components/brain/selection'
import { joinPath, type SharedFileRef, type SharedFilesTree } from '@/components/brain/useSharedFilesTree'
import { Button } from '@/components/ui/button'
import { FileUploadMenu } from '@/components/ui/file-upload-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { isCardType } from '@/lib/brain/labels'
import { humanizeTableName } from '@/lib/data/table-name'
import type { EngineDbTable } from '@/lib/engine/types'
import type { UploadEntry } from '@/lib/files/upload'
import { BrainIcon, ChevronRightIcon, FileIcon, FolderIcon, GlobeIcon, InboxIcon, PlusIcon, SearchIcon, TableIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BrainPageSummary } from '@rerun/contracts'
import { useMemo, useState, type ReactNode, type Ref } from 'react'

type BrainSidebarProps = {
    pages: BrainPageSummary[]
    // False on a box from before the Brain: the files and the database still work there.
    pagesAvailable: boolean
    selection: BrainSelection | null
    openProposals: number
    publishedEnabled: boolean
    files: SharedFilesTree
    // Null while the shared database is being listed.
    tables: EngineDbTable[] | null
    searchRef: Ref<HTMLInputElement>
    onSelect: (selection: BrainSelection) => void
    onUpload: (entries: UploadEntry[], dir: string) => void
}

function SidebarRow({
    icon: Glyph,
    label,
    active,
    depth = 0,
    leading,
    trailing,
    draggableFile,
    tooltip,
    expanded,
    onClick,
}: {
    icon: LucideIcon
    label: string
    tooltip?: string
    active: boolean
    depth?: number
    leading?: ReactNode
    trailing?: ReactNode
    draggableFile?: SharedFileRef
    expanded?: boolean
    onClick: () => void
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            onClick={onClick}
            onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onClick()
            }}
            draggable={Boolean(draggableFile)}
            onDragStart={
                draggableFile
                    ? event => {
                          event.dataTransfer.setData(SHARED_FILE_DRAG_TYPE, JSON.stringify(draggableFile))
                          event.dataTransfer.effectAllowed = 'copy'
                      }
                    : undefined
            }
            title={tooltip}
            style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
            className={cn(
                'group/row flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
        >
            {leading}
            <Glyph className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing}
        </div>
    )
}

function SectionHeader({ label, action, active, onClick }: { label: string; action?: ReactNode; active?: boolean; onClick?: () => void }) {
    return (
        <div className="group/section flex h-7 items-center justify-between pl-2 pr-1 pt-3">
            {onClick ? (
                <button type="button" onClick={onClick} className={cn('-ml-1 rounded px-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground', active ? 'text-foreground' : 'text-muted-foreground/80')}>
                    {label}
                </button>
            ) : (
                <span className="text-[11px] font-medium text-muted-foreground/80">{label}</span>
            )}
            {action && <div className="opacity-0 transition-opacity group-hover/section:opacity-100 has-[[aria-expanded=true]]:opacity-100 max-sm:opacity-100">{action}</div>}
        </div>
    )
}

function FolderRows({ dir, depth, files, selection, onSelect }: { dir: string; depth: number; files: SharedFilesTree; selection: BrainSelection | null; onSelect: (selection: BrainSelection) => void }) {
    const entries = files.entriesOf(dir)
    const indent = `${(dir ? 1.5 : 0.5) + depth * 0.875}rem`
    if (!entries) return (
            <div style={{ paddingLeft: indent }} className="flex h-7 items-center">
                <Skeleton className="h-3 w-24" />
            </div>
        )
    if (entries.length === 0) return <p style={{ paddingLeft: indent }} className="py-1 text-xs text-muted-foreground/70">{dir ? 'Empty folder' : 'No files yet'}</p>

    return entries.map(entry => <FileTreeRow key={entry.name} dir={dir} entry={entry} depth={depth} files={files} selection={selection} onSelect={onSelect} />)
}

function FileTreeRow({ dir, entry, depth, files, selection, onSelect }: { dir: string; entry: FileEntry; depth: number; files: SharedFilesTree; selection: BrainSelection | null; onSelect: (selection: BrainSelection) => void }) {
    const path = joinPath(dir, entry.name)

    if (entry.type !== 'dir') {
        return <SidebarRow icon={FileIcon} label={entry.name} depth={depth} leading={<span className="w-3.5 shrink-0" />} active={selection?.kind === 'file' && selection.path === path} draggableFile={{ path, name: entry.name }} onClick={() => onSelect({ kind: 'file', path })} />
    }

    const open = files.expanded.has(path)
    return (
        <>
            <SidebarRow
                icon={FolderIcon}
                label={entry.name}
                depth={depth}
                active={selection?.kind === 'folder' && selection.path === path}
                leading={
                    <button
                        type="button"
                        aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                        onClick={event => {
                            event.stopPropagation()
                            files.toggle(path)
                        }}
                        className="-ml-0.5 flex size-4 shrink-0 items-center justify-center rounded hover:bg-foreground/10"
                    >
                        <ChevronRightIcon className={cn('size-3 transition-transform duration-150', open && 'rotate-90')} />
                    </button>
                }
                onClick={() => {
                    files.expand(path)
                    onSelect({ kind: 'folder', path })
                }}
            />
            {open && <FolderRows dir={path} depth={depth + 1} files={files} selection={selection} onSelect={onSelect} />}
        </>
    )
}

// One tree for everything the workspace shares, as Notion keeps its pages and databases side by
// side: what agents proposed, the company pages, the shared folder and the shared database.
export function BrainSidebar({ pages, pagesAvailable, selection, openProposals, publishedEnabled, files, tables, searchRef, onSelect, onUpload }: BrainSidebarProps) {
    const [query, setQuery] = useState('')
    const card = pages.filter(page => isCardType(page.type))
    const products = pages.filter(page => page.type === 'product')
    const others = pages.filter(page => !isCardType(page.type) && page.type !== 'product')
    // Null until the person folds or unfolds it: open then only while one of them is selected.
    const [productsExpanded, setProductsExpanded] = useState<boolean | null>(null)

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return null
        return {
            pages: pages.filter(page => page.title.toLowerCase().includes(needle) || page.slug.includes(needle)),
            files: files.knownFiles.filter(file => file.path.toLowerCase().includes(needle)).slice(0, 30),
            tables: (tables ?? []).filter(table => table.name.toLowerCase().includes(needle) || humanizeTableName(table.name).toLowerCase().includes(needle)),
        }
    }, [query, pages, files.knownFiles, tables])

    const isSelected = (page: BrainPageSummary) => (selection?.kind === 'page' || selection?.kind === 'history') && selection.slug === page.slug
    // A shop's catalogue brings up to 25 product pages: folded away, they leave the other pages in view.
    const productsOpen = productsExpanded ?? products.some(isSelected)

    const pageRow = (page: BrainPageSummary, depth = 0) => (
        <SidebarRow
            key={page.slug}
            icon={BRAIN_PAGE_ICONS[page.type]}
            label={page.title}
            depth={depth}
            leading={depth > 0 ? <span className="w-3.5 shrink-0" /> : undefined}
            active={isSelected(page)}
            onClick={() => onSelect({ kind: 'page', slug: page.slug })}
        />
    )

    const tableRow = (table: EngineDbTable) => (
        <SidebarRow
            key={table.name}
            icon={TableIcon}
            label={humanizeTableName(table.name)}
            tooltip={table.name}
            active={selection?.kind === 'table' && selection.name === table.name}
            onClick={() => onSelect({ kind: 'table', name: table.name })}
        />
    )

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="space-y-2 px-2 pb-1 pt-3">
                <div className="flex items-center gap-2 px-2">
                    <BrainIcon className="size-4 shrink-0" />
                    <span className="text-sm font-semibold">Brain</span>
                </div>
                <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        ref={searchRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => event.key === 'Escape' && query && (event.stopPropagation(), setQuery(''))}
                        placeholder="Search"
                        aria-label="Search pages and files"
                        className="h-7 pl-8 text-sm"
                    />
                    <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70 max-sm:hidden">⌘K</kbd>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {results ? (
                    <>
                        <SectionHeader label="Pages" />
                        {results.pages.length ? results.pages.map(page => pageRow(page)) : <p className="px-2 py-1 text-xs text-muted-foreground/70">No page matches</p>}
                        <SectionHeader label="Files" />
                        {results.files.length ? (
                            results.files.map(file => (
                                <SidebarRow key={file.path} icon={FileIcon} label={file.path} active={selection?.kind === 'file' && selection.path === file.path} draggableFile={file} onClick={() => onSelect({ kind: 'file', path: file.path })} />
                            ))
                        ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground/70">No file opened so far matches</p>
                        )}
                        <SectionHeader label="Tables" />
                        {results.tables.length ? results.tables.map(tableRow) : <p className="px-2 py-1 text-xs text-muted-foreground/70">No table matches</p>}
                    </>
                ) : (
                    <>
                        <div className="pt-1">
                            <SidebarRow
                                icon={InboxIcon}
                                label="Proposals"
                                active={selection?.kind === 'proposals'}
                                onClick={() => onSelect({ kind: 'proposals' })}
                                trailing={openProposals > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white tabular-nums">{openProposals}</span>}
                            />
                            {publishedEnabled && <SidebarRow icon={GlobeIcon} label="Published" active={selection?.kind === 'published'} onClick={() => onSelect({ kind: 'published' })} />}
                        </div>

                        <SectionHeader label="Company" />
                        {pagesAvailable ? card.map(page => pageRow(page)) : <p className="px-2 py-1 text-xs text-muted-foreground/70">Not on this box yet</p>}

                        {pagesAvailable && (
                            <>
                                <SectionHeader
                                    label="Pages"
                                    action={
                                        <Button size="icon-xs" variant="ghost" onClick={() => onSelect({ kind: 'new-page' })} aria-label="New page" title="New page">
                                            <PlusIcon />
                                        </Button>
                                    }
                                />
                                {products.length > 0 && (
                                    <>
                                        <SidebarRow
                                            icon={BRAIN_PAGE_ICONS.product}
                                            label="Products"
                                            active={false}
                                            expanded={productsOpen}
                                            leading={<ChevronRightIcon className={cn('-ml-0.5 size-3 shrink-0 transition-transform duration-150', productsOpen && 'rotate-90')} />}
                                            trailing={<span className="text-[11px] tabular-nums text-muted-foreground/70">{products.length}</span>}
                                            onClick={() => setProductsExpanded(!productsOpen)}
                                        />
                                        {productsOpen && products.map(page => pageRow(page, 1))}
                                    </>
                                )}
                                {others.map(page => pageRow(page))}
                                <SidebarRow icon={PlusIcon} label="New page" active={selection?.kind === 'new-page'} onClick={() => onSelect({ kind: 'new-page' })} />
                            </>
                        )}

                        <SectionHeader
                            label="Files"
                            active={selection?.kind === 'folder' && selection.path === ''}
                            onClick={() => onSelect({ kind: 'folder', path: '' })}
                            action={<FileUploadMenu onPick={entries => onUpload(entries, '')} />}
                        />
                        <FolderRows dir="" depth={0} files={files} selection={selection} onSelect={onSelect} />

                        <SectionHeader label="Database" active={selection?.kind === 'database'} onClick={() => onSelect({ kind: 'database' })} />
                        {tables === null ? (
                            <div className="flex h-7 items-center px-2">
                                <Skeleton className="h-3 w-24" />
                            </div>
                        ) : tables.length ? (
                            tables.map(tableRow)
                        ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground/70">No tables yet</p>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
