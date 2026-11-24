'use client'

import { templateCategoryLabel, type TemplateCategoryCopy, type TemplateStatus } from '@rerun/contracts'
import { brandIconFilter } from '@rerun/ui/brand-icon'
import { ScrollFade } from '@rerun/ui/primitives'
import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TemplateCreatorAvatar } from '@/components/templates/TemplateCreatorAvatar'
import { TemplateLibraryCompactNav } from '@/components/templates/TemplateLibraryCompactNav'
import { TemplateLibraryDiscover, TemplateLibraryDiscoverSkeleton } from '@/components/templates/TemplateLibraryDiscover'
import { TemplateLibraryEmpty } from '@/components/templates/TemplateLibraryEmpty'
import { TemplateLibraryGrid } from '@/components/templates/TemplateLibraryGrid'
import { TemplateLibraryRail, type LibraryNavCounts } from '@/components/templates/TemplateLibraryRail'
import { TemplateLibraryUseCases, TemplateLibraryUseCasesSkeleton } from '@/components/templates/TemplateLibraryUseCases'
import { TemplateTileSkeleton } from '@/components/templates/TemplateTileSkeleton'
import { TemplateVerifiedBadge } from '@/components/templates/TemplateVerifiedBadge'
import { Button } from '@/components/ui/button'
import { FilterSelect, type FilterOption } from '@/components/ui/filter-select'
import { UserIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { EMPTY_LIBRARY_FILTERS, filterTemplates, type LibraryCreator, type LibraryTemplate } from '@/lib/templates/library'
import { appCounts, categoryCounts, creatorSummaries, DISCOVER_VIEW, type LibraryMode, type LibraryView, matchesQuery, templatesInView, type ViewerSignals } from '@/lib/templates/library-view'
import { landingUrl } from '@/lib/site'
import { templateStatusLabel } from '@/lib/templates/status'
import { coworkerUseCases, findUseCases, type UseCase } from '@/lib/templates/use-cases'

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
    selectedUseCaseId,
    onSelectTemplate,
    onSelectUseCase,
    onScratch,
}: {
    templates: LibraryTemplate[] | null
    // Null while it loads: Discover then introduces the template authors alone.
    directory: LibraryCreator[] | null
    isAdmin: boolean
    signals: ViewerSignals
    now: Date
    selectedSlug: string | null
    selectedUseCaseId: string | null
    onSelectTemplate: (slug: string) => void
    onSelectUseCase: (useCase: UseCase) => void
    onScratch: () => void
}) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const tStatus = useTranslations('templates.status')
    const statusOptions: FilterOption<TemplateStatus>[] = LIBRARY_STATUSES.map(status => ({ value: status, label: templateStatusLabel(status, tStatus) }))
    const [chosenView, setChosenView] = useState<LibraryView>(DISCOVER_VIEW)
    // Which of the two lists the viewer was last on: what a search from Discover looks through.
    const [mode, setMode] = useState<LibraryMode>('coworkers')
    const [query, setQuery] = useState('')
    const [connectorSlugs, setConnectorSlugs] = useState<string[]>([])
    const [statuses, setStatuses] = useState<TemplateStatus[]>([])
    const scrollerRef = useRef<HTMLDivElement>(null)

    // What anybody may browse: the published catalogue plus the viewer's own work. The admin-only
    // statuses widen the lists, never Discover, which stays the page a visitor sees.
    const catalogue = useMemo(() => (templates ? filterTemplates(templates, EMPTY_LIBRARY_FILTERS) : null), [templates])
    const connectorOptions = useMemo(() => connectorOptionsOf(catalogue ?? []), [catalogue])

    const searching = query.trim() !== ''
    const view: LibraryView = searching && chosenView.kind !== 'list' ? { kind: 'list', mode, category: null } : chosenView
    const onDiscover = view.kind === 'discover'
    const onUseCases = view.kind === 'list' && view.mode === 'use-cases'
    const creatorSlug = view.kind === 'creator' ? view.slug : null
    const creator = useMemo(() => (creatorSlug && catalogue ? (creatorSummaries(catalogue).find(c => c.slug === creatorSlug) ?? null) : null), [creatorSlug, catalogue])

    // Both lists under the same search and the same filters, so every count on screen moves together.
    const filtered = useMemo(() => templates && filterTemplates(templates, { ...EMPTY_LIBRARY_FILTERS, connectorSlugs, statuses }), [templates, connectorSlugs, statuses])
    const coworkers = useMemo(() => filtered && filtered.filter(t => matchesQuery(t, query)), [filtered, query])
    const everyUseCase = useMemo(() => filtered && filtered.flatMap(coworkerUseCases), [filtered])
    const useCases = useMemo(() => everyUseCase && findUseCases(everyUseCase, { query, connectorSlugs }), [everyUseCase, query, connectorSlugs])

    const category = view.kind === 'list' ? view.category : null
    const counts = useMemo<LibraryNavCounts>(() => {
        if (!catalogue || !coworkers || !useCases) return null
        const listed = mode === 'use-cases' ? useCases.map(useCase => useCase.template) : coworkers
        return {
            totals: { coworkers: coworkers.length, 'use-cases': useCases.length },
            // In the order of the whole catalogue, so a search never shuffles the rail. The category
            // the viewer is on stays, even once nothing is left in it.
            categories: categoryCounts(catalogue)
                .map(row => ({ category: row.category, count: listed.filter(t => t.category === row.category).length }))
                .filter(row => row.count > 0 || row.category === category),
        }
    }, [catalogue, coworkers, useCases, mode, category])

    const listedCoworkers = coworkers && templatesInView(coworkers, view)
    const listedUseCases = useCases && (category ? useCases.filter(useCase => useCase.template.category === category) : useCases)
    const count = (onDiscover ? catalogue : onUseCases ? listedUseCases : listedCoworkers)?.length ?? null

    // Discover shows the whole catalogue and no filter: one left on would only shrink the rail's counts.
    function clearFilters() {
        setConnectorSlugs([])
        setStatuses([])
    }

    function navigate(next: LibraryView) {
        setChosenView(next)
        if (next.kind === 'list') setMode(next.mode)
        else setQuery('')
        if (next.kind === 'discover') clearFilters()
        scrollerRef.current?.scrollTo({ top: 0 })
    }

    function search(next: string) {
        // A search starts on the whole list, then narrows to a category the viewer picks under it.
        if (!searching && chosenView.kind === 'list') setChosenView({ ...chosenView, category: null })
        if (!next.trim() && chosenView.kind === 'discover') clearFilters()
        setQuery(next)
        scrollerRef.current?.scrollTo({ top: 0 })
    }

    const isFiltered = searching || connectorSlugs.length > 0 || statuses.length > 0
    const revealKey = `${JSON.stringify(view)}|${connectorSlugs.join(',')}|${statuses.join(',')}`
    const heading = headingFor(t, tCategory, { view, query, count, creatorName: creator?.name })

    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1">
            <div className="hidden lg:flex">
                <TemplateLibraryRail view={view} query={query} counts={counts} onView={navigate} onQuery={search} onScratch={onScratch} />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <TemplateLibraryCompactNav view={view} mode={mode} query={query} counts={counts} onView={navigate} onQuery={search} onScratch={onScratch} />

                <ScrollFade scrollRef={scrollerRef} className="@container min-h-0 flex-1 overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex flex-col gap-6 px-5 pt-5 pb-10 lg:px-8 lg:pt-7">
                        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pr-8">
                            <div className="flex min-w-0 items-center gap-3.5">
                                {creator && <TemplateCreatorAvatar creator={creator} size={44} />}
                                <div className="min-w-0">
                                    <h2 className="font-heading flex min-w-0 items-center gap-2 text-2xl leading-tight font-semibold tracking-tight">
                                        <span className="truncate">{heading.title}</span>
                                        {creator?.verified && <TemplateVerifiedBadge className="size-4.5" />}
                                    </h2>
                                    <p className="mt-1 min-h-5 truncate text-sm text-muted-foreground">
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

                        {catalogue === null || listedCoworkers === null || listedUseCases === null ? (
                            onDiscover ? (
                                <TemplateLibraryDiscoverSkeleton />
                            ) : onUseCases ? (
                                <TemplateLibraryUseCasesSkeleton />
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
                        ) : onUseCases && listedUseCases.length === 0 ? (
                            <TemplateLibraryEmpty filtered={isFiltered} onScratch={onScratch} />
                        ) : onUseCases ? (
                            <TemplateLibraryUseCases key={revealKey} useCases={listedUseCases} selectedId={selectedUseCaseId} scrollRef={scrollerRef} onSelect={onSelectUseCase} />
                        ) : (
                            <TemplateLibraryGrid
                                templates={listedCoworkers}
                                selectedSlug={selectedSlug}
                                showStatus={t => isAdmin || t.isMine}
                                onSelectTemplate={onSelectTemplate}
                                empty={listedCoworkers.length === 0}
                                filtered={isFiltered}
                                revealKey={revealKey}
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

function headingFor(t: LibraryTranslator, tCategory: TemplateCategoryCopy, { view, query, count, creatorName }: { view: LibraryView; query: string; count: number | null; creatorName?: string }): { title: string; subtitle: string } {
    if (view.kind === 'discover') return { title: t('nav.discover'), subtitle: count === 0 ? t('heading.discoverEmpty') : t('heading.discover') }
    const onUseCases = view.kind === 'list' && view.mode === 'use-cases'
    const subtitle = count === null ? '' : onUseCases ? t('heading.useCases', { count }) : t('heading.coworkers', { count })
    if (query.trim()) return { title: t('heading.results', { query: query.trim() }), subtitle }
    if (view.kind === 'creator') return { title: creatorName ?? t('heading.creator'), subtitle }
    return { title: view.category ? templateCategoryLabel(view.category, tCategory) : t(`mode.${view.mode}`), subtitle }
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
