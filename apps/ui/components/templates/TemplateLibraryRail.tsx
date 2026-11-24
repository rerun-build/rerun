'use client'

import { templateCategoryLabel, type TemplateCategory } from '@rerun/contracts'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'
import { TemplateLibrarySearch } from '@/components/templates/TemplateLibrarySearch'
import { Button } from '@/components/ui/button'
import { CompassIcon, ListTodoIcon, PlusIcon, UsersIcon } from '@/lib/icons'
import { LIBRARY_MODES, type LibraryMode, type LibraryView } from '@/lib/templates/library-view'
import { cn } from '@/lib/utils'

export type LibraryNavCounts = { totals: Record<LibraryMode, number>; categories: { category: TemplateCategory; count: number }[] } | null

export type LibraryNavProps = {
    // What the page shows, which a search moves from Discover to a list.
    view: LibraryView
    // The list a search, or a category, narrows.
    mode: LibraryMode
    query: string
    // Null while the catalogue loads: the navigation keeps its shape and only the numbers wait.
    counts: LibraryNavCounts
    onView: (view: LibraryView) => void
    onQuery: (query: string) => void
    onScratch: () => void
}

const MODE_ICONS = { coworkers: UsersIcon, 'use-cases': ListTodoIcon }

export function TemplateLibraryRail({ view, query, counts, onView, onQuery, onScratch }: Omit<LibraryNavProps, 'mode'>) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const category = view.kind === 'list' ? view.category : null

    return (
        <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/20">
            <div className="flex flex-col gap-3 px-3 pt-6 pb-3">
                <h2 className="px-2 font-heading text-lg leading-none font-semibold tracking-tight">{t('templates')}</h2>
                <TemplateLibrarySearch value={query} onChange={onQuery} />
            </div>

            <ScrollFade className="min-h-0 flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <nav aria-label={t('title')} className="flex flex-col px-3 pb-3">
                    <RailItem icon={CompassIcon} label={t('nav.discover')} active={view.kind === 'discover'} onClick={() => onView({ kind: 'discover' })} />
                    {LIBRARY_MODES.map(mode => {
                        const open = view.kind === 'list' && view.mode === mode
                        return (
                            <div key={mode}>
                                <RailItem
                                    icon={MODE_ICONS[mode]}
                                    label={t(`mode.${mode}`)}
                                    count={counts?.totals[mode]}
                                    active={open && category === null}
                                    strong={open}
                                    expanded={open}
                                    onClick={() => onView({ kind: 'list', mode, category: null })}
                                />
                                {/* Rows rather than height: a list has no height to animate to. */}
                                <div inert={!open} className={cn('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                                    <div className="min-h-0 overflow-hidden">
                                        <div className="my-1 ml-[1.05rem] border-l pl-2">
                                            {counts?.categories.map(row => (
                                                <RailItem
                                                    key={row.category}
                                                    label={templateCategoryLabel(row.category, tCategory)}
                                                    count={row.count}
                                                    active={category === row.category}
                                                    onClick={() => onView({ kind: 'list', mode, category: row.category })}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </nav>
            </ScrollFade>

            <div className="border-t p-3">
                <Button type="button" size="lg" className="w-full" onClick={onScratch}>
                    <PlusIcon />
                    {t('createCoworker')}
                </Button>
            </div>
        </aside>
    )
}

function RailItem({ icon: Glyph, label, count, active, strong = false, expanded, onClick }: { icon?: ComponentType<{ className?: string }>; label: string; count?: number; active: boolean; strong?: boolean; expanded?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            aria-expanded={expanded}
            className={cn(
                'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors',
                active ? 'bg-foreground/[0.07] font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                strong && 'font-medium text-foreground',
            )}
        >
            {Glyph && <Glyph className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {count !== undefined && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </button>
    )
}
