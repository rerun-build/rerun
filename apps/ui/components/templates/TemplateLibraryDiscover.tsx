'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { TemplateCreatorCard } from '@/components/templates/TemplateCreatorCard'
import { TemplateCreatorSpotlight } from '@/components/templates/TemplateCreatorSpotlight'
import { TemplateLibraryGrid } from '@/components/templates/TemplateLibraryGrid'
import { TemplateLibrarySection, TemplateLibrarySectionLink } from '@/components/templates/TemplateLibrarySection'
import { TemplateTileSkeleton } from '@/components/templates/TemplateTileSkeleton'
import { Skeleton } from '@/components/ui/skeleton'
import type { LibraryCreator, LibraryTemplate } from '@/lib/templates/library'
import { creatorOfTheWeek, creatorSummaries, creatorsToMeet, hasViewerSignals, type LibraryView, newestFirst, rankForViewer, type ViewerSignals } from '@/lib/templates/library-view'
import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'

const PICKS = 4
const NEWEST = 4
const CREATORS_SHOWN = 5
// As many cards as the row has columns, so the row never ends on a gap: four on two lines, then
// three, four and five on one as the column widens.
const CREATOR_CARD_VISIBILITY = ['', '', '', '@min-[40rem]:hidden @min-[52rem]:flex', 'hidden @min-[60rem]:flex']

export function TemplateLibraryDiscover({
    templates,
    directory,
    signals,
    now,
    selectedSlug,
    isAdmin,
    onSelectTemplate,
    onView,
}: {
    templates: LibraryTemplate[]
    directory: LibraryCreator[]
    signals: ViewerSignals
    now: Date
    selectedSlug: string | null
    isAdmin: boolean
    onSelectTemplate: (slug: string) => void
    onView: (view: LibraryView) => void
}) {
    const t = useTranslations('templates.library.discover')
    const creators = useMemo(() => creatorSummaries(templates, directory), [templates, directory])
    const spotlight = useMemo(() => creatorOfTheWeek(creators, now), [creators, now])
    const otherCreators = useMemo(() => creatorsToMeet(creators, { exclude: spotlight?.creator.slug, seed: now.getTime(), count: CREATORS_SHOWN }), [creators, spotlight, now])

    const personal = hasViewerSignals(signals)
    const picks = useMemo(() => {
        if (personal) return rankForViewer(templates, signals).slice(0, PICKS)
        const featured = templates.filter(t => t.featured)
        return (featured.length > 0 ? featured : templates).slice(0, PICKS)
    }, [templates, signals, personal])
    // Whatever the picks above already show is left out, so the two grids never repeat a card.
    const newest = useMemo(() => newestFirst(templates.filter(t => !picks.includes(t))).slice(0, NEWEST), [templates, picks])

    const grid = (items: LibraryTemplate[], key: string) => (
        <TemplateLibraryGrid templates={items} selectedSlug={selectedSlug} showStatus={t => isAdmin || t.isMine} onSelectTemplate={onSelectTemplate} empty={false} filtered={false} revealKey={key} />
    )
    const seeAll = <TemplateLibrarySectionLink onClick={() => onView({ kind: 'all' })}>{t('seeAll')}</TemplateLibrarySectionLink>

    return (
        <div className="flex flex-col gap-8">
            {spotlight && (
                <TemplateCreatorSpotlight
                    creator={spotlight.creator}
                    template={spotlight.template}
                    selected={selectedSlug === spotlight.template.slug}
                    onSelectTemplate={() => onSelectTemplate(spotlight.template.slug)}
                />
            )}

            {otherCreators.length > 0 && (
                <TemplateLibrarySection title={t('creators')} subtitle={t('creatorsSubtitle')} action={<TemplateLibrarySectionLink href={landingUrl('/community/experts')}>{t('allCreators')}</TemplateLibrarySectionLink>}>
                    <div className="grid grid-cols-2 gap-3 @min-[40rem]:grid-cols-3 @min-[52rem]:grid-cols-4 @min-[60rem]:grid-cols-5">
                        {otherCreators.map((creator, index) => (
                            <TemplateCreatorCard key={creator.slug} creator={creator} onOpen={() => onView({ kind: 'creator', slug: creator.slug })} className={cn(CREATOR_CARD_VISIBILITY[index])} />
                        ))}
                    </div>
                </TemplateLibrarySection>
            )}

            {picks.length > 0 && (
                <TemplateLibrarySection title={personal ? t('forYou') : t('featured')} subtitle={personal ? t('forYouSubtitle') : t('featuredSubtitle')} action={<TemplateLibrarySectionLink onClick={() => onView({ kind: 'foryou' })}>{t('seeAll')}</TemplateLibrarySectionLink>}>
                    {grid(picks, 'picks')}
                </TemplateLibrarySection>
            )}

            {newest.length > 0 && (
                <TemplateLibrarySection title={t('justAdded')} subtitle={t('justAddedSubtitle')} action={seeAll}>
                    {grid(newest, 'newest')}
                </TemplateLibrarySection>
            )}
        </div>
    )
}

// Mirrors the page above: the spotlight band, then one section of tiles.
export function TemplateLibraryDiscoverSkeleton() {
    return (
        <div className="flex flex-col gap-8">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <div className="flex flex-col gap-4">
                <div>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3.5 w-56" />
                </div>
                <div className="grid grid-cols-1 gap-x-5 gap-y-8 @min-[28rem]:grid-cols-2 @min-[46rem]:grid-cols-3 @min-[62rem]:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <TemplateTileSkeleton key={i} />
                    ))}
                </div>
            </div>
        </div>
    )
}
