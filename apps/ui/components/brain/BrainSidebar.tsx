'use client'

import type { FileEntry } from '@/app/api/_actions/workspace-file.actions'
import { SHARED_FILE_DRAG_TYPE } from '@/components/brain/editor/file-link'
import type { BrainNewPageDraft } from '@/components/brain/BrainNewPage'
import type { BrainSelection } from '@/components/brain/selection'
import { joinPath, type SharedFileRef, type SharedFilesTree } from '@/components/brain/useSharedFilesTree'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useBoxLabel } from '@/components/brain/BrainItemProperties'
import { filesOfBox, pagesOfBox, type BrainFiling } from '@/lib/brain/items'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { isCardType } from '@/lib/brain/labels'
import { humanizeTableName } from '@/lib/data/table-name'
import type { EngineDbTable } from '@/lib/engine/types'
import { ArchiveIcon, BoxIcon, BrainIcon, ChevronRightIcon, FileIcon, FolderIcon, GlobeIcon, InboxIcon, LayersIcon, PlusIcon, SearchIcon, Share2Icon, TableIcon, UploadIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BrainFileMeta, BrainPageSummary, BrainSkill } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useMemo, useState, type ReactNode, type Ref } from 'react'

type BrainSidebarProps = {
    pages: BrainPageSummary[]
    skills?: BrainSkill[]
    // False on a box from before the Brain's skills: nothing there can write one.
    skillsAvailable?: boolean
    // False on a box from before the Brain: the files and the database still work there.
    pagesAvailable: boolean
    selection: BrainSelection | null
    openProposals: number
    publishedEnabled: boolean
    files: SharedFilesTree
    // Null while the shared database is being listed.
    tables: EngineDbTable[] | null
    filing: BrainFiling
    // The page being written, shown in its Box until it is created.
    newPageDraft: BrainNewPageDraft | null
    searchRef: Ref<HTMLInputElement>
    onSelect: (selection: BrainSelection) => void
    // Opens the import, set to file what comes in under this Box (null for everyone).
    onImport: (spaceId: string | null) => void
}

const NO_SKILLS: BrainSkill[] = []

// What only shows on hover stays there on a phone, on a touch screen, and while the row has the keyboard focus.
const SHOWN_WITHOUT_HOVER = 'max-sm:flex [@media(pointer:coarse)]:flex group-focus-within/row:flex'

function fileIcon(file: BrainFileMeta): LucideIcon {
    if (file.kind === 'dir') return FolderIcon
    return file.path.toLowerCase().endsWith('.zip') ? ArchiveIcon : FileIcon
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
    placeholder,
    fresh,
    onClick,
}: {
    icon: LucideIcon
    label: string
    // The label is a stand-in (an untitled page), drawn fainter.
    placeholder?: boolean
    // Lights up once as it appears.
    fresh?: boolean
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
            style={{ paddingInlineStart: `${0.5 + depth * 0.875}rem` }}
            className={cn(
                'group/row flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pe-1.5 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:h-9',
                active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                fresh && 'animate-[brain-row-fresh_1.2s_ease-out]',
            )}
        >
            {leading}
            <Glyph className="size-3.5 shrink-0" />
            <span className={cn('min-w-0 flex-1 truncate', placeholder && 'text-muted-foreground/60')}>{label}</span>
            {trailing}
        </div>
    )
}

function SectionHeader({ label, action, active, onClick }: { label: string; action?: ReactNode; active?: boolean; onClick?: () => void }) {
    return (
        <div className="group/section flex h-7 items-center justify-between ps-2 pe-1 pt-3">
            {onClick ? (
                <button type="button" onClick={onClick} className={cn('-ms-1 rounded px-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-foreground', active ? 'text-foreground' : 'text-muted-foreground/80')}>
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
    const t = useTranslations('brain.sidebar')
    const entries = files.entriesOf(dir)
    const indent = `${(dir ? 1.5 : 0.5) + depth * 0.875}rem`
    if (!entries) return (
            <div style={{ paddingInlineStart: indent }} className="flex h-7 items-center">
                <Skeleton className="h-3 w-24" />
            </div>
        )
    if (entries.length === 0) return <p style={{ paddingInlineStart: indent }} className="py-1 text-xs text-muted-foreground/70">{dir ? t('emptyFolder') : t('noFiles')}</p>

    return entries.map(entry => <FileTreeRow key={entry.name} dir={dir} entry={entry} depth={depth} files={files} selection={selection} onSelect={onSelect} />)
}

function FileTreeRow({ dir, entry, depth, files, selection, onSelect }: { dir: string; entry: FileEntry; depth: number; files: SharedFilesTree; selection: BrainSelection | null; onSelect: (selection: BrainSelection) => void }) {
    const t = useTranslations('brain.sidebar')
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
                        aria-label={open ? t('collapse', { name: entry.name }) : t('expand', { name: entry.name })}
                        onClick={event => {
                            event.stopPropagation()
                            files.toggle(path)
                        }}
                        className="-ms-0.5 flex size-4 shrink-0 items-center justify-center rounded hover:bg-foreground/10"
                    >
                        <ChevronRightIcon className={cn('size-3 transition-transform duration-150', open && 'rotate-90 rtl:-rotate-90')} />
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
export function BrainSidebar({ pages, skills = NO_SKILLS, skillsAvailable = false, pagesAvailable, selection, openProposals, publishedEnabled, files, tables, filing, newPageDraft, searchRef, onSelect, onImport }: BrainSidebarProps) {
    const t = useTranslations('brain.sidebar')
    const tCrumbs = useTranslations('brain.crumbs')
    const boxLabel = useBoxLabel()
    const [query, setQuery] = useState('')
    const everyone = pagesOfBox(null, pages, filing.boxes)
    const card = everyone.filter(page => isCardType(page.type))
    const products = everyone.filter(page => page.type === 'product')
    const others = everyone.filter(page => !isCardType(page.type) && page.type !== 'product')
    // Null until the person folds or unfolds it: open then only while one of them is selected.
    const [productsExpanded, setProductsExpanded] = useState<boolean | null>(null)
    // A Box nobody folded or unfolded yet is open while it holds what is selected.
    const [boxesExpanded, setBoxesExpanded] = useState<Record<string, boolean>>({})

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return null
        return {
            pages: pages.filter(page => page.title.toLowerCase().includes(needle) || page.slug.includes(needle)),
            skills: skills.filter(skill => skill.name.toLowerCase().includes(needle) || skill.slug.includes(needle)),
            files: files.knownFiles.filter(file => file.path.toLowerCase().includes(needle)).slice(0, 30),
            tables: (tables ?? []).filter(table => table.name.toLowerCase().includes(needle) || humanizeTableName(table.name).toLowerCase().includes(needle)),
        }
    }, [query, pages, skills, files.knownFiles, tables])

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

    const isFileSelected = (path: string) => (selection?.kind === 'file' || selection?.kind === 'folder') && selection.path === path

    const boxRows = (boxId: string) => {
        const boxPages = pagesOfBox(boxId, pages, filing.boxes)
        const boxFiles = filesOfBox(boxId, filing.files)
        const draft = newPageDraft?.spaceId === boxId ? newPageDraft : null
        const holdsSelection = Boolean(draft) || boxPages.some(isSelected) || boxFiles.some(file => isFileSelected(file.path)) || (selection?.kind === 'box' && selection.spaceId === boxId)
        const open = boxesExpanded[boxId] ?? holdsSelection
        const box = filing.boxes.find(entry => entry.id === boxId) ?? null
        const name = boxLabel(box)
        const newPageHere = () => {
            setBoxesExpanded(current => ({ ...current, [boxId]: true }))
            onSelect({ kind: 'new-page', spaceId: boxId })
        }
        return (
            <div key={boxId}>
                <SidebarRow
                    icon={BoxIcon}
                    label={name}
                    active={selection?.kind === 'box' && selection.spaceId === boxId}
                    expanded={open}
                    leading={
                        <button
                            type="button"
                            aria-label={open ? t('collapse', { name }) : t('expand', { name })}
                            onClick={event => {
                                event.stopPropagation()
                                setBoxesExpanded(current => ({ ...current, [boxId]: !open }))
                            }}
                            className="-ms-0.5 flex size-4 shrink-0 items-center justify-center rounded hover:bg-foreground/10"
                        >
                            <ChevronRightIcon className={cn('size-3 transition-transform duration-150', open && 'rotate-90 rtl:-rotate-90')} />
                        </button>
                    }
                    trailing={
                        <>
                            <span className="min-w-4 text-center text-[11px] tabular-nums text-muted-foreground/70 group-hover/row:hidden">{boxPages.length + boxFiles.length + (draft ? 1 : 0)}</span>
                            <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t('newPageIn', { name })}
                                title={t('newPageIn', { name })}
                                className={cn('hidden size-5 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground group-hover/row:flex max-sm:size-7', SHOWN_WITHOUT_HOVER)}
                                onClick={event => {
                                    event.stopPropagation()
                                    newPageHere()
                                }}
                            >
                                <PlusIcon />
                            </Button>
                        </>
                    }
                    onClick={() => {
                        setBoxesExpanded(current => ({ ...current, [boxId]: true }))
                        onSelect({ kind: 'box', spaceId: boxId })
                    }}
                />
                {open && boxPages.map(page => pageRow(page, 1))}
                {open && draft && (
                    <SidebarRow
                        icon={BRAIN_PAGE_ICONS[draft.type]}
                        label={draft.title.trim() || tCrumbs('untitled')}
                        placeholder={!draft.title.trim()}
                        fresh
                        depth={1}
                        leading={<span className="w-3.5 shrink-0" />}
                        active
                        onClick={() => selection && onSelect(selection)}
                    />
                )}
                {open &&
                    boxFiles.map(file => {
                        const folder = file.kind === 'dir'
                        return (
                            <SidebarRow
                                key={file.path}
                                icon={fileIcon(file)}
                                label={file.path.split('/').pop() ?? file.path}
                                tooltip={file.path}
                                depth={1}
                                leading={<span className="w-3.5 shrink-0" />}
                                active={isFileSelected(file.path)}
                                draggableFile={folder ? undefined : { path: file.path, name: file.path.split('/').pop() ?? file.path }}
                                onClick={() => onSelect({ kind: folder ? 'folder' : 'file', path: file.path })}
                            />
                        )
                    })}
                {open && <SidebarRow icon={PlusIcon} label={t('newPage')} depth={1} leading={<span className="w-3.5 shrink-0" />} active={false} onClick={newPageHere} />}
            </div>
        )
    }

    const skillRow = (skill: BrainSkill) => <SidebarRow key={skill.slug} icon={LayersIcon} label={skill.name} active={selection?.kind === 'skill' && selection.slug === skill.slug} onClick={() => onSelect({ kind: 'skill', slug: skill.slug })} />

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
                <div className="flex items-center gap-2 ps-2">
                    <BrainIcon className="size-4 shrink-0" />
                    <span className="flex-1 text-sm font-semibold">{t('title')}</span>
                    <Button size="icon-xs" variant="ghost" onClick={() => onImport(null)} aria-label={t('import')} title={t('importHint')}>
                        <UploadIcon />
                    </Button>
                </div>
                <div className="relative">
                    <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        ref={searchRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => event.key === 'Escape' && query && (event.stopPropagation(), setQuery(''))}
                        placeholder={t('search')}
                        aria-label={t('searchLabel')}
                        className="h-7 ps-8 text-sm"
                    />
                    <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70 max-sm:hidden">⌘K</kbd>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {results ? (
                    <>
                        <SectionHeader label={t('pages')} />
                        {results.pages.length ? results.pages.map(page => pageRow(page)) : <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('noPageMatches')}</p>}
                        {results.skills.length > 0 && (
                            <>
                                <SectionHeader label={t('skills')} />
                                {results.skills.map(skillRow)}
                            </>
                        )}
                        <SectionHeader label={t('files')} />
                        {results.files.length ? (
                            results.files.map(file => (
                                <SidebarRow key={file.path} icon={FileIcon} label={file.path} active={selection?.kind === 'file' && selection.path === file.path} draggableFile={file} onClick={() => onSelect({ kind: 'file', path: file.path })} />
                            ))
                        ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('noFileMatches')}</p>
                        )}
                        <SectionHeader label={t('tables')} />
                        {results.tables.length ? results.tables.map(tableRow) : <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('noTableMatches')}</p>}
                    </>
                ) : (
                    <>
                        <div className="pt-1">
                            <SidebarRow
                                icon={InboxIcon}
                                label={t('proposals')}
                                active={selection?.kind === 'proposals'}
                                onClick={() => onSelect({ kind: 'proposals' })}
                                trailing={openProposals > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white tabular-nums">{openProposals}</span>}
                            />
                            {publishedEnabled && <SidebarRow icon={GlobeIcon} label={t('published')} active={selection?.kind === 'published'} onClick={() => onSelect({ kind: 'published' })} />}
                        </div>

                        <SectionHeader
                            label={t('everyone')}
                            action={
                                pagesAvailable && (
                                    <Button size="icon-xs" variant="ghost" onClick={() => onSelect({ kind: 'new-page' })} aria-label={t('newPage')} title={t('newPage')}>
                                        <PlusIcon />
                                    </Button>
                                )
                            }
                        />
                        {!pagesAvailable && <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('notOnBox')}</p>}

                        {pagesAvailable && (
                            <>
                                {card.map(page => pageRow(page))}
                                {products.length > 0 && (
                                    <>
                                        <SidebarRow
                                            icon={BRAIN_PAGE_ICONS.product}
                                            label={t('products')}
                                            active={false}
                                            expanded={productsOpen}
                                            leading={<ChevronRightIcon className={cn('-ms-0.5 size-3 shrink-0 transition-transform duration-150', productsOpen && 'rotate-90 rtl:-rotate-90')} />}
                                            trailing={<span className="text-[11px] tabular-nums text-muted-foreground/70">{products.length}</span>}
                                            onClick={() => setProductsExpanded(!productsOpen)}
                                        />
                                        {productsOpen && products.map(page => pageRow(page, 1))}
                                    </>
                                )}
                                {others.map(page => pageRow(page))}
                                <SidebarRow icon={PlusIcon} label={t('newPage')} active={selection?.kind === 'new-page' && !newPageDraft?.spaceId} onClick={() => onSelect({ kind: 'new-page' })} />
                            </>
                        )}

                        {pagesAvailable && skillsAvailable && (
                            <>
                                <SectionHeader
                                    label={t('skills')}
                                    active={selection?.kind === 'skills'}
                                    onClick={() => onSelect({ kind: 'skills' })}
                                    action={
                                        <Button size="icon-xs" variant="ghost" onClick={() => onSelect({ kind: 'share-skill' })} aria-label={t('shareSkill')} title={t('shareSkill')}>
                                            <Share2Icon />
                                        </Button>
                                    }
                                />
                                {skills.map(skillRow)}
                                {skills.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('noSkills')}</p>}
                                <SidebarRow icon={PlusIcon} label={t('newSkill')} active={selection?.kind === 'new-skill'} onClick={() => onSelect({ kind: 'new-skill' })} />
                            </>
                        )}

                        {pagesAvailable && filing.boxes.length > 0 && (
                            <>
                                <SectionHeader label={t('boxes')} />
                                {filing.boxes.map(box => boxRows(box.id))}
                            </>
                        )}

                        <SectionHeader
                            label={t('files')}
                            active={selection?.kind === 'folder' && selection.path === ''}
                            onClick={() => onSelect({ kind: 'folder', path: '' })}
                            action={
                                <Button size="icon-xs" variant="ghost" onClick={() => onImport(null)} aria-label={t('import')} title={t('importHint')}>
                                    <UploadIcon />
                                </Button>
                            }
                        />
                        <FolderRows dir="" depth={0} files={files} selection={selection} onSelect={onSelect} />

                        <SectionHeader label={t('database')} active={selection?.kind === 'database'} onClick={() => onSelect({ kind: 'database' })} />
                        {tables === null ? (
                            <div className="flex h-7 items-center px-2">
                                <Skeleton className="h-3 w-24" />
                            </div>
                        ) : tables.length ? (
                            tables.map(tableRow)
                        ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground/70">{t('noTables')}</p>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
