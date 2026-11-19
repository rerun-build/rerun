'use client'

import type { CoworkerDockCoworker, CoworkerDockEdge } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { GripVerticalIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type DockProps = {
    coworkers: CoworkerDockCoworker[]
    edge: CoworkerDockEdge
    collapsed: boolean
    // Why "+" is disabled, shown on hover; none when it works.
    createBlockedReason?: string | null
    onOpen: (coworker: CoworkerDockCoworker) => void
    onCreate: () => void
    onToggleCollapsed: () => void
    onGrab: (event: ReactPointerEvent) => void
    // The element the coworkers scroll in, for the page that measures them while the rail is resized.
    scrollRef?: RefObject<HTMLDivElement | null>
}

// The side a tooltip opens to: towards the middle of the screen, away from the edge.
function inward(edge: CoworkerDockEdge) {
    return edge === 'right' ? 'left' : 'right'
}

export function pendingTotal(coworkers: readonly CoworkerDockCoworker[]) {
    return coworkers.reduce((sum, coworker) => sum + coworker.pending, 0)
}

export function CountPip({ count, tone = 'brand', className }: { count: number; tone?: 'brand' | 'error'; className?: string }) {
    if (count <= 0) return null
    return (
        <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-popover', tone === 'error' ? 'bg-destructive' : 'bg-brand', className)}>
            {count > 9 ? '9+' : count}
        </span>
    )
}

export function DockBuddy({ coworker, edge, onOpen }: { coworker: CoworkerDockCoworker; edge: CoworkerDockEdge; onOpen: (coworker: CoworkerDockCoworker) => void }) {
    return (
        <TooltipLabeled side={inward(edge)} label={coworker.name}>
            <button type="button" onClick={() => onOpen(coworker)} aria-label={coworker.name} className="flex shrink-0 items-center justify-center rounded-xl p-1 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <AgentBuddy agentId={coworker.id} mood={coworker.mood} size={34} facing={edge === 'right' ? 'left' : 'right'} badge={<CountPip count={coworker.pending} tone={coworker.mood === 'error' ? 'error' : 'brand'} />} />
            </button>
        </TooltipLabeled>
    )
}

export function DockAdd({ edge, blockedReason, onCreate }: { edge: CoworkerDockEdge; blockedReason?: string | null; onCreate: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <TooltipDisabledReason reason={blockedReason ?? undefined} side={inward(edge)}>
            <TooltipLabeled side={inward(edge)} label={t('newCoworker')}>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={!!blockedReason}
                    aria-label={t('newCoworker')}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                    <PlusIcon className="size-4" />
                </button>
            </TooltipLabeled>
        </TooltipDisabledReason>
    )
}

// Drag it along the edge, or across the screen to the other edge. A double click folds it.
export function DockGrip({ onGrab, onToggleCollapsed }: { onGrab: (event: ReactPointerEvent) => void; onToggleCollapsed: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <button
            type="button"
            aria-label={t('move')}
            onPointerDown={onGrab}
            onDoubleClick={onToggleCollapsed}
            className="flex h-4 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
        >
            <GripVerticalIcon className="size-3.5 rotate-90" />
        </button>
    )
}

// A thin band on the top or the bottom edge of the rail: drag it to set how tall the rail may grow, a
// double click lets it grow with its coworkers again.
export function DockResizeEdge({ side, onGrab, onReset }: { side: 'top' | 'bottom'; onGrab: (event: ReactPointerEvent) => void; onReset: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('resize')}
            onPointerDown={onGrab}
            onDoubleClick={onReset}
            className={cn('group absolute inset-x-0 z-10 flex h-1.5 cursor-ns-resize touch-none justify-center', side === 'top' ? 'top-0 items-start' : 'bottom-0 items-end')}
        >
            <span className="h-0.5 w-5 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground/50" />
        </div>
    )
}
