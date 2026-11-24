'use client'

import { AgentBuddy } from '@rerun/ui/iso-grid'
import { PANEL_CARD, PANEL_CARD_INTERACTIVE } from '@rerun/ui/primitives'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { TemplateConnectorLogos } from '@/components/templates/TemplateConnectorLogos'
import { Skeleton } from '@/components/ui/skeleton'
import { useLoadMoreOnScroll } from '@/hooks/useLoadMoreOnScroll'
import type { UseCase } from '@/lib/templates/use-cases'
import { cn } from '@/lib/utils'

const PAGE = 48

const GRID = 'grid grid-cols-1 gap-3 @min-[34rem]:grid-cols-2 @min-[56rem]:grid-cols-3'
const CARD = 'flex min-w-0 flex-col rounded-xl p-4'

// The catalogue holds hundreds of use cases and is meant to grow: the list draws itself as it is read.
export function TemplateLibraryUseCases({ useCases, selectedId, scrollRef, onSelect }: { useCases: UseCase[]; selectedId: string | null; scrollRef: RefObject<HTMLElement | null>; onSelect: (useCase: UseCase) => void }) {
    const [limit, setLimit] = useState(PAGE)
    const sentinelRef = useRef<HTMLDivElement>(null)
    const loadMore = useCallback(() => setLimit(current => current + PAGE), [])
    useLoadMoreOnScroll({ sentinelRef, rootRef: scrollRef, enabled: limit < useCases.length, loaded: limit, loadMore })

    return (
        <div>
            <div className={GRID}>
                {useCases.slice(0, limit).map(useCase => (
                    <UseCaseCard key={useCase.id} useCase={useCase} selected={selectedId === useCase.id} onSelect={() => onSelect(useCase)} />
                ))}
            </div>
            <div ref={sentinelRef} />
        </div>
    )
}

function UseCaseCard({ useCase, selected, onSelect }: { useCase: UseCase; selected: boolean; onSelect: () => void }) {
    return (
        <button type="button" aria-pressed={selected} onClick={onSelect} className={cn(PANEL_CARD, PANEL_CARD_INTERACTIVE, CARD, 'text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50', selected && 'ring-2 ring-primary')}>
            <span className="text-[15px] leading-tight font-semibold tracking-tight break-words">{useCase.name}</span>
            <span className="mt-1.5 line-clamp-2 min-h-[2lh] text-[13px] leading-snug text-muted-foreground">{useCase.summary}</span>
            <span className="mt-auto flex items-center justify-between gap-3 pt-4">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <AgentBuddy agentId={useCase.agent.key} size={22} animated={false} facing="right" className="shrink-0" />
                    <span className="truncate">{useCase.agent.name}</span>
                </span>
                {useCase.connectors.length > 0 && <TemplateConnectorLogos connectors={useCase.connectors} />}
            </span>
        </button>
    )
}

// Mirrors UseCaseCard: the task, its two lines, then the coworker and its apps.
export function TemplateLibraryUseCasesSkeleton() {
    return (
        <div aria-hidden className={GRID}>
            {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className={cn(PANEL_CARD, CARD)}>
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="mt-3.5 h-3 w-full" />
                    <Skeleton className="mt-1.5 h-3 w-4/5" />
                    <div className="mt-4 flex items-center justify-between gap-3">
                        <Skeleton className="h-[22px] w-28" />
                        <Skeleton className="h-3.5 w-10" />
                    </div>
                </div>
            ))}
        </div>
    )
}
