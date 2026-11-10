'use client'

import type { TemplateCategory } from '@rerun/contracts'
import { templateCategoryLabel } from '@rerun/contracts'
import type { ComponentType, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ConnectorLogo } from '@/components/templates/TemplateConnectorLogos'
import { TemplateLibrarySearch } from '@/components/templates/TemplateLibrarySearch'
import { Button } from '@/components/ui/button'
import { BookmarkIcon, CompassIcon, Grid2x2Icon, PlusIcon, SparkleIcon } from '@/lib/icons'
import { TEMPLATE_CATEGORY_ICONS } from '@/lib/templates/category-icons'
import { type AppCount, isSameView, type LibraryView } from '@/lib/templates/library-view'
import { cn } from '@/lib/utils'

export type LibraryRailCounts = { all: number; mine: number; stack: { mine: boolean; apps: AppCount[] }; categories: { category: TemplateCategory; count: number }[] } | null

export function TemplateLibraryRail({
    view,
    query,
    counts,
    onView,
    onQuery,
    onScratch,
}: {
    view: LibraryView
    query: string
    // Null while the catalogue loads: the rail keeps its shape and only the numbers wait.
    counts: LibraryRailCounts
    onView: (view: LibraryView) => void
    onQuery: (query: string) => void
    onScratch: () => void
}) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const searching = query.trim() !== ''
    const isActive = (target: LibraryView) => !searching && isSameView(view, target)

    return (
        <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/20">
            <div className="flex flex-col gap-3 px-3 pt-6 pb-3">
                <div className="flex items-baseline gap-2 px-2">
                    <h2 className="font-heading text-lg leading-none font-semibold tracking-tight">{t('templates')}</h2>
                    {counts && <span className="text-xs text-muted-foreground tabular-nums">{counts.all}</span>}
                </div>
                <TemplateLibrarySearch value={query} onChange={onQuery} />
            </div>

            <nav aria-label={t('title')} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
                <RailItem icon={CompassIcon} label={t('nav.discover')} active={isActive({ kind: 'discover' })} onClick={() => onView({ kind: 'discover' })} />
                <RailItem icon={SparkleIcon} label={t('nav.forYou')} active={isActive({ kind: 'foryou' })} onClick={() => onView({ kind: 'foryou' })} />
                <RailItem icon={Grid2x2Icon} label={t('nav.allTemplates')} count={counts?.all} active={isActive({ kind: 'all' })} onClick={() => onView({ kind: 'all' })} />
                {!!counts?.mine && <RailItem icon={BookmarkIcon} label={t('nav.mine')} count={counts.mine} active={isActive({ kind: 'mine' })} onClick={() => onView({ kind: 'mine' })} />}

                {counts && counts.stack.apps.length > 0 && (
                    <>
                        <RailLabel>{counts.stack.mine ? t('nav.stack') : t('nav.popularApps')}</RailLabel>
                        {counts.stack.apps.map(({ connector, count }) => (
                            <RailItem
                                key={connector.slug}
                                leading={<ConnectorLogo connector={connector} className="size-4" />}
                                label={connector.name}
                                count={count}
                                active={isActive({ kind: 'app', slug: connector.slug })}
                                onClick={() => onView({ kind: 'app', slug: connector.slug })}
                            />
                        ))}
                    </>
                )}

                {counts && counts.categories.length > 0 && (
                    <>
                        <RailLabel>{t('nav.categories')}</RailLabel>
                        {counts.categories.map(({ category, count }) => (
                            <RailItem
                                key={category}
                                icon={TEMPLATE_CATEGORY_ICONS[category] ?? TEMPLATE_CATEGORY_ICONS.other}
                                label={templateCategoryLabel(category, tCategory)}
                                count={count}
                                active={isActive({ kind: 'category', category })}
                                onClick={() => onView({ kind: 'category', category })}
                            />
                        ))}
                    </>
                )}
            </nav>

            <div className="border-t p-3">
                <Button type="button" size="lg" className="w-full" onClick={onScratch}>
                    <PlusIcon />
                    {t('createCoworker')}
                </Button>
            </div>
        </aside>
    )
}

function RailLabel({ children }: { children: ReactNode }) {
    return <p className="mt-6 mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">{children}</p>
}

function RailItem({ icon: Glyph, leading, label, count, active, onClick }: { icon?: ComponentType<{ className?: string }>; leading?: ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors',
                active ? 'bg-foreground/[0.07] font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
        >
            {Glyph ? <Glyph className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} /> : leading}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {count !== undefined && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </button>
    )
}
