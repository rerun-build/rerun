'use client'

import { templateCategoryLabel, type TemplateCategoryCopy, type TemplateStatus } from '@rerun/contracts'
import { brandIconFilter } from '@rerun/ui/brand-icon'
import { HScrollFade, ScrollFade } from '@rerun/ui/primitives'
import { type ComponentProps, type ReactNode, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ConnectorLogo } from '@/components/templates/TemplateConnectorLogos'
import { TemplateCreatorAvatar } from '@/components/templates/TemplateCreatorAvatar'
import { TemplateLibraryDiscover, TemplateLibraryDiscoverSkeleton } from '@/components/templates/TemplateLibraryDiscover'
import { TemplateLibraryEmpty } from '@/components/templates/TemplateLibraryEmpty'
import { TemplateLibraryGrid } from '@/components/templates/TemplateLibraryGrid'
import { TemplateLibraryRail, type LibraryRailCounts } from '@/components/templates/TemplateLibraryRail'
import { TemplateLibrarySearch } from '@/components/templates/TemplateLibrarySearch'
import { TemplateTileSkeleton } from '@/components/templates/TemplateTileSkeleton'
import { TemplateVerifiedBadge } from '@/components/templates/TemplateVerifiedBadge'
import { Button } from '@/components/ui/button'
import { FilterSelect, type FilterOption } from '@/components/ui/filter-select'
import { Icon } from '@/components/ui/icon'
import { ChevronDownIcon, PlusIcon, UserIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { TEMPLATE_CATEGORY_ICONS } from '@/lib/templates/category-icons'
import { EMPTY_LIBRARY_FILTERS, filterTemplates, isInMyLibrary, type LibraryCreator, type LibraryTemplate } from '@/lib/templates/library'
import { appCounts, categoryCounts, creatorSummaries, stackApps, DISCOVER_VIEW, isSameView, type LibraryView, matchesQuery, templatesInView, type ViewerSignals } from '@/lib/templates/library-view'
import { landingUrl } from '@/lib/site'
import { templateStatusLabel } from '@/lib/templates/status'
import { cn } from '@/lib/utils'

// The statuses the library read actually returns to an admin: `archived` is never fetched.
const LIBRARY_STATUSES: TemplateStatus[] = ['published', 'unlisted', 'in_review', 'draft']

// The library's browsing side: the rail on the left, the page it points at on the right. It knows
// nothing of the dialog or of the detail panel, which is what lets the render lab mount it alone.
export function TemplateLibraryBrowser({
    templates,
    directory,
    isAdmin,
    signals,
    now,
    selectedSlug,
    onSelectTemplate,
    onScratch,
}: {
    templates: LibraryTemplate[] | null
    // Null while it loads: Discover then introduces the template authors alone.
    directory: LibraryCreator[] | null
    isAdmin: boolean
    signals: ViewerSignals
    now: Date
    selectedSlug: string | null
    onSelectTemplate: (slug: string) => void
    onScratch: () => void
}) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const tStatus = useTranslations('templates.status')
    const statusOptions: FilterOption<TemplateStatus>[] = LIBRARY_STATUSES.map(status => ({ value: status, label: templateStatusLabel(status, tStatus) }))
    const [view, setView] = useState<LibraryView>(DISCOVER_VIEW)
    const [query, setQuery] = useState('')
    const [connectorSlugs, setConnectorSlugs] = useState<string[]>([])
    const [statuses, setStatuses] = useState<TemplateStatus[]>([])
    const scrollerRef = useRef<HTMLDivElement>(null)

    // What anybody may browse: the published catalogue plus the viewer's own work. The admin-only
    // statuses widen the lists, never Discover, which stays the page a visitor sees.
    const catalogue = useMemo(() => (templates ? filterTemplates(templates, EMPTY_LIBRARY_FILTERS) : null), [templates])
    const counts = useMemo<LibraryRailCounts>(
        () => catalogue && { all: catalogue.length, mine: catalogue.filter(isInMyLibrary).length, stack: stackApps(catalogue, signals.connectorSlugs), categories: categoryCounts(catalogue) },
        [catalogue, signals.connectorSlugs],
    )
    const app = useMemo(() => (view.kind === 'app' && catalogue ? (appCounts(catalogue).find(a => a.connector.slug === view.slug)?.connector ?? null) : null), [view, catalogue])
    const creator = useMemo(() => (view.kind === 'creator' && catalogue ? (creatorSummaries(catalogue).find(c => c.slug === view.slug) ?? null) : null), [view, catalogue])
    const connectorOptions = useMemo(() => connectorOptionsOf(catalogue ?? []), [catalogue])

    const searching = query.trim() !== ''
    const onDiscover = !searching && view.kind === 'discover'
    const listed = useMemo(() => {
        if (!templates) return null
        const narrowed = filterTemplates(templates, { ...EMPTY_LIBRARY_FILTERS, connectorSlugs, statuses })
        return (searching ? narrowed : templatesInView(narrowed, view, signals)).filter(t => matchesQuery(t, query))
    }, [templates, connectorSlugs, statuses, searching, view, query, signals])

    function navigate(next: LibraryView) {
        setView(next)
        setQuery('')
        scrollerRef.current?.scrollTo({ top: 0 })
    }

    function search(next: string) {
        setQuery(next)
        scrollerRef.current?.scrollTo({ top: 0 })
    }

    const heading = headingFor(t, tCategory, { view, query, count: listed?.length ?? null, creatorName: creator?.name, appName: app?.name })

    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1">
            <div className="hidden lg:flex">
                <TemplateLibraryRail view={view} query={query} counts={counts} onView={navigate} onQuery={search} onScratch={onScratch} />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <CompactNav view={view} query={query} counts={counts} onView={navigate} onQuery={search} onScratch={onScratch} />

                <ScrollFade scrollRef={scrollerRef} className="@container min-h-0 flex-1 overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex flex-col gap-6 px-5 pt-5 pb-10 lg:px-8 lg:pt-7">
                        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pr-8">
                            <div className="flex min-w-0 items-center gap-3.5">
                                {creator && <TemplateCreatorAvatar creator={creator} size={44} />}
                                {app && <Icon {...serviceIconProps(app.icon)} size="lg" className="shrink-0" />}
                                <div className="min-w-0">
                                    <h2 className="font-heading flex min-w-0 items-center gap-2 text-2xl leading-tight font-semibold tracking-tight">
                                        <span className="truncate">{heading.title}</span>
                                        {creator?.verified && <TemplateVerifiedBadge className="size-4.5" />}
                                    </h2>
                                    <p className="mt-1 truncate text-sm text-muted-foreground">
                                        {heading.subtitle}
                                        {creator?.location && ` · ${creator.location}`}
                                    </p>
                                </div>
                            </div>
                            {!onDiscover && (
                                <div className="flex items-center gap-2">
                                    {creator && (
                                        <Button asChild variant="outline" size="lg">
                                            <a href={landingUrl(`/community/experts/${creator.slug}`)} target="_blank" rel="noreferrer">
                                                <UserIcon className="size-4" />
                                                {t('viewProfile')}
                                            </a>
                                        </Button>
                                    )}
                                    <FilterSelect label={t('filters.app')} options={connectorOptions} values={connectorSlugs} onChange={setConnectorSlugs} loading={catalogue === null} />
                                    {isAdmin && <FilterSelect label={t('filters.status')} options={statusOptions} values={statuses} onChange={setStatuses} />}
                                </div>
                            )}
                        </header>

                        {catalogue === null || listed === null ? (
                            onDiscover ? (
                                <TemplateLibraryDiscoverSkeleton />
                            ) : (
                                <div className="grid grid-cols-1 gap-x-5 gap-y-8 @min-[28rem]:grid-cols-2 @min-[46rem]:grid-cols-3 @min-[62rem]:grid-cols-4">
                                    {Array.from({ length: 8 }).map((_, i) => (
                                        <TemplateTileSkeleton key={i} />
                                    ))}
                                </div>
                            )
                        ) : onDiscover && catalogue.length === 0 ? (
                            <TemplateLibraryEmpty filtered={false} onScratch={onScratch} />
                        ) : onDiscover ? (
                            <TemplateLibraryDiscover templates={catalogue} directory={directory ?? []} signals={signals} now={now} selectedSlug={selectedSlug} isAdmin={isAdmin} onSelectTemplate={onSelectTemplate} onView={navigate} />
                        ) : (
                            <TemplateLibraryGrid
                                templates={listed}
                                selectedSlug={selectedSlug}
                                showStatus={t => isAdmin || t.isMine}
                                onSelectTemplate={onSelectTemplate}
                                empty={listed.length === 0}
                                filtered={searching || connectorSlugs.length > 0 || statuses.length > 0}
                                revealKey={`${JSON.stringify(view)}|${connectorSlugs.join(',')}|${statuses.join(',')}`}
                                onScratch={onScratch}
                            />
                        )}
                    </div>
                </ScrollFade>
            </div>
        </div>
    )
}

type LibraryTranslator = ReturnType<typeof useTranslations<'templates.library'>>

function headingFor(t: LibraryTranslator, tCategory: TemplateCategoryCopy, { view, query, count, creatorName, appName }: { view: LibraryView; query: string; count: number | null; creatorName?: string; appName?: string }): { title: string; subtitle: string } {
    const total = count === null ? '' : t('heading.count', { count })
    if (query.trim()) return { title: t('heading.results', { query: query.trim() }), subtitle: total }
    switch (view.kind) {
        case 'discover':
            return { title: t('nav.discover'), subtitle: count === 0 ? t('heading.discoverEmpty') : t('heading.discover') }
        case 'foryou':
            return { title: t('nav.forYou'), subtitle: t('heading.forYou') }
        case 'all':
            return { title: t('nav.allTemplates'), subtitle: total }
        case 'mine':
            return { title: t('nav.mine'), subtitle: t('heading.mine') }
        case 'category':
            return { title: templateCategoryLabel(view.category, tCategory), subtitle: total }
        case 'app':
            return { title: appName ?? t('heading.app'), subtitle: t('heading.appSubtitle', { total, app: appName ?? t('heading.thisApp') }) }
        case 'creator':
            return { title: creatorName ?? t('heading.creator'), subtitle: total }
    }
}

// The apps the catalogue actually uses, most used first: offering one nothing declares would only
// ever lead to an empty grid.
function connectorOptionsOf(templates: LibraryTemplate[]): FilterOption[] {
    return appCounts(templates).map(({ connector }) => ({ value: connector.slug, label: connector.name, icon: <ConnectorGlyph icon={connector.icon} /> }))
}

function ConnectorGlyph({ icon }: { icon: string | null }) {
    const props = serviceIconProps(icon)
    if ('src' in props) return <img src={props.src} alt="" aria-hidden className="size-2.5 shrink-0 object-contain" style={{ filter: brandIconFilter(props.src) }} />
    const Glyph = props.icon
    return <Glyph className="size-2.5 shrink-0" />
}

// Below lg the rail would leave the page too narrow, so its links fold into one row: the main views,
// then one chip per group that unfolds its entries underneath.
type CompactNavGroup = 'apps' | 'categories'

function CompactNav({ view, query, counts, onView, onQuery, onScratch }: { view: LibraryView; query: string; counts: LibraryRailCounts; onView: (view: LibraryView) => void; onQuery: (query: string) => void; onScratch: () => void }) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const [openGroup, setOpenGroup] = useState<CompactNavGroup | null>(null)
    const searching = query.trim() !== ''
    const isActive = (target: LibraryView) => !searching && isSameView(view, target)

    const links: { view: LibraryView; label: string }[] = [
        { view: { kind: 'discover' }, label: t('nav.discover') },
        { view: { kind: 'foryou' }, label: t('nav.forYou') },
        { view: { kind: 'all' }, label: t('nav.all') },
        ...(counts?.mine ? [{ view: { kind: 'mine' } as LibraryView, label: t('nav.mine') }] : []),
    ]
    const apps = counts?.stack.apps ?? []
    const categories = counts?.categories ?? []
    const activeApp = !searching && view.kind === 'app' ? apps.find(({ connector }) => connector.slug === view.slug) : undefined
    const activeCategory = !searching && view.kind === 'category' ? view.category : null

    function go(next: LibraryView) {
        setOpenGroup(null)
        onView(next)
    }

    function toggle(group: CompactNavGroup) {
        setOpenGroup(current => (current === group ? null : group))
    }

    return (
        <div className="flex shrink-0 flex-col gap-3 border-b px-5 pt-5 pb-3 lg:hidden">
            <div className="flex items-center gap-2 pr-8">
                <TemplateLibrarySearch
                    value={query}
                    onChange={next => {
                        setOpenGroup(null)
                        onQuery(next)
                    }}
                    className="min-w-0 flex-1"
                />
                <Button type="button" size="sm" onClick={onScratch} className="shrink-0">
                    <PlusIcon />
                    {t('newCoworker')}
                </Button>
            </div>
            <div className="flex flex-col">
                <HScrollFade className="-mx-1 gap-1.5 px-1" fadeClassName="from-popover">
                    {links.map(link => (
                        <NavChip key={link.view.kind} active={isActive(link.view)} aria-current={isActive(link.view) ? 'page' : undefined} onClick={() => go(link.view)}>
                            {link.label}
                        </NavChip>
                    ))}
                    {apps.length > 0 && (
                        <NavChip active={!!activeApp} aria-expanded={openGroup === 'apps'} onClick={() => toggle('apps')}>
                            {activeApp?.connector.name ?? (counts?.stack.mine ? t('nav.stack') : t('nav.popularApps'))}
                            <ChevronDownIcon className={cn('size-3.5 transition-transform', openGroup === 'apps' && 'rotate-180')} />
                        </NavChip>
                    )}
                    {categories.length > 0 && (
                        <NavChip active={activeCategory !== null} aria-expanded={openGroup === 'categories'} onClick={() => toggle('categories')}>
                            {activeCategory ? templateCategoryLabel(activeCategory, tCategory) : t('nav.categories')}
                            <ChevronDownIcon className={cn('size-3.5 transition-transform', openGroup === 'categories' && 'rotate-180')} />
                        </NavChip>
                    )}
                </HScrollFade>

                <NavGroupPanel open={openGroup === 'apps'}>
                    {apps.map(({ connector, count }) => (
                        <NavChip key={connector.slug} quiet active={activeApp?.connector.slug === connector.slug} aria-current={activeApp?.connector.slug === connector.slug ? 'page' : undefined} onClick={() => go({ kind: 'app', slug: connector.slug })}>
                            <ConnectorLogo connector={connector} />
                            {connector.name}
                            <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                        </NavChip>
                    ))}
                </NavGroupPanel>
                <NavGroupPanel open={openGroup === 'categories'}>
                    {categories.map(({ category, count }) => {
                        const Glyph = TEMPLATE_CATEGORY_ICONS[category] ?? TEMPLATE_CATEGORY_ICONS.other
                        return (
                            <NavChip key={category} quiet active={activeCategory === category} aria-current={activeCategory === category ? 'page' : undefined} onClick={() => go({ kind: 'category', category })}>
                                <Glyph className="size-3.5 shrink-0" />
                                {templateCategoryLabel(category, tCategory)}
                                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                            </NavChip>
                        )
                    })}
                </NavGroupPanel>
            </div>
        </div>
    )
}

// `quiet` is the active state of an entry that carries a brand logo, which a filled chip would
// leave unreadable.
function NavChip({ active, quiet = false, className, ...props }: ComponentProps<'button'> & { active: boolean; quiet?: boolean }) {
    return (
        <button
            type="button"
            className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors',
                !active && 'text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                active && (quiet ? 'border-foreground/30 bg-foreground/[0.07] font-medium text-foreground' : 'border-foreground bg-foreground text-background'),
                className,
            )}
            {...props}
        />
    )
}

// Rows rather than height: a wrapping list has no height to animate to.
function NavGroupPanel({ open, children }: { open: boolean; children: ReactNode }) {
    return (
        <div inert={!open} className={cn('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className="min-h-0 overflow-hidden">
                <div className="flex flex-wrap gap-1.5 pt-2.5">{children}</div>
            </div>
        </div>
    )
}
