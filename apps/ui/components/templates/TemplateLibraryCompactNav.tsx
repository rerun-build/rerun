'use client'

import { templateCategoryLabel } from '@rerun/contracts'
import { HScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { LibraryNavProps } from '@/components/templates/TemplateLibraryRail'
import { TemplateLibrarySearch } from '@/components/templates/TemplateLibrarySearch'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@/lib/icons'
import { LIBRARY_MODES } from '@/lib/templates/library-view'
import { cn } from '@/lib/utils'

// Below lg the rail would leave the page too narrow: its two lists become a switch, and what narrows
// them one row of chips.
export function TemplateLibraryCompactNav({ view, mode, query, counts, onView, onQuery, onScratch }: LibraryNavProps) {
    const t = useTranslations('templates.library')
    const tCategory = useTranslations('templates.categories')
    const category = view.kind === 'list' ? view.category : null
    const openMode = view.kind === 'list' ? view.mode : null

    return (
        <div className="flex shrink-0 flex-col gap-3 border-b px-5 pt-5 pb-3 lg:hidden">
            <div className="flex items-center gap-2 pe-8">
                <TemplateLibrarySearch value={query} onChange={onQuery} className="min-w-0 flex-1" />
                <Button type="button" size="sm" onClick={onScratch} className="shrink-0">
                    <PlusIcon />
                    {t('newCoworker')}
                </Button>
            </div>
            <div className="grid grid-cols-2 gap-0.5 rounded-lg border bg-background/40 p-0.5">
                {LIBRARY_MODES.map(target => (
                    <button
                        key={target}
                        type="button"
                        aria-pressed={openMode === target}
                        onClick={() => onView({ kind: 'list', mode: target, category })}
                        className={cn(
                            'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium whitespace-nowrap transition-colors',
                            openMode === target ? 'bg-foreground/[0.09] text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <span className="truncate">{t(`mode.${target}`)}</span>
                        {counts && <span className="text-xs font-normal text-muted-foreground tabular-nums">{counts.totals[target]}</span>}
                    </button>
                ))}
            </div>
            <HScrollFade className="-mx-1 gap-1.5 px-1" fadeClassName="from-popover">
                <NavChip active={view.kind === 'discover'} onClick={() => onView({ kind: 'discover' })}>
                    {t('nav.discover')}
                </NavChip>
                <NavChip active={view.kind === 'list' && category === null} onClick={() => onView({ kind: 'list', mode, category: null })}>
                    {t('nav.all')}
                </NavChip>
                {counts?.categories.map(row => (
                    <NavChip key={row.category} active={category === row.category} onClick={() => onView({ kind: 'list', mode, category: row.category })}>
                        {templateCategoryLabel(row.category, tCategory)}
                    </NavChip>
                ))}
            </HScrollFade>
        </div>
    )
}

function NavChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn('flex h-7 shrink-0 items-center rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors', active ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:border-foreground/20 hover:text-foreground')}
        >
            {children}
        </button>
    )
}
