'use client'

import type { CoworkerDockCoworker, CoworkerDockEdge } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { Orb } from '@/components/foreman/Orb'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { foremanDockOrbState, isForemanDockEntry } from '@/lib/desktop-shell/coworker-dock'
import { GripVerticalIcon, InboxIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type DockProps = {
    coworkers: CoworkerDockCoworker[]
    edge: CoworkerDockEdge
    collapsed: boolean
    // Why "+" is disabled, shown on hover; none when it works.
    createBlockedReason?: string | null
    onOpen: (coworker: CoworkerDockCoworker) => void
    // Right-click on a coworker: the shell's menu, which can hide it.
    onMenu: (coworker: CoworkerDockCoworker) => void
    // The coworkers in the order they were dragged to; absent, they cannot be dragged.
    onReorder?: (agentIds: string[]) => void
    onDraggingChange?: (dragging: boolean) => void
    onCreate: () => void
    onToggleCollapsed: () => void
    onGrab: (event: ReactPointerEvent) => void
    // The shells that show the notes on the dock: the button that lists everyone's, and whose card is open.
    inbox?: { active: string | 'all' | null; onOpen: () => void }
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
        <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2 ring-popover', tone === 'error' ? 'bg-destructive text-white' : 'bg-brand text-brand-ink', className)}>
            {count > 9 ? '9+' : count}
        </span>
    )
}

const BUDDY_SIZE = 34

function ForemanBuddy({ coworker, edge }: { coworker: CoworkerDockCoworker; edge: CoworkerDockEdge }) {
    return (
        <span data-dock-foreman className="relative flex size-[34px] items-center justify-center">
            <Orb size={BUDDY_SIZE - 6} state={foremanDockOrbState(coworker.mood)} facing={edge === 'right' ? 'left' : 'right'} />
            <CountPip count={coworker.pending} tone={coworker.mood === 'error' ? 'error' : 'brand'} className="absolute -top-1 -end-1" />
        </span>
    )
}

// `active`: its card is open on the dock. `data-coworker` is where a bubble or the card points.
type DockBuddyProps = { coworker: CoworkerDockCoworker; edge: CoworkerDockEdge; active?: boolean; onOpen: (coworker: CoworkerDockCoworker) => void; onMenu: (coworker: CoworkerDockCoworker) => void }

export function DockBuddy({ coworker, edge, active = false, onOpen, onMenu }: DockBuddyProps) {
    return (
        <TooltipLabeled side={inward(edge)} label={coworker.name}>
            <button
                type="button"
                onClick={() => onOpen(coworker)}
                onContextMenu={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    onMenu(coworker)
                }}
                aria-label={coworker.name}
                data-coworker={coworker.id}
                className={cn('flex shrink-0 items-center justify-center rounded-xl p-1 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', active && 'bg-accent')}
            >
                {isForemanDockEntry(coworker) ? (
                    <ForemanBuddy coworker={coworker} edge={edge} />
                ) : (
                    <AgentBuddy agentId={coworker.id} mood={coworker.mood} size={BUDDY_SIZE} facing={edge === 'right' ? 'left' : 'right'} badge={<CountPip count={coworker.pending} tone={coworker.mood === 'error' ? 'error' : 'brand'} />} />
                )}
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

export function DockInbox({ edge, total, active, onOpen }: { edge: CoworkerDockEdge; total: number; active: boolean; onOpen: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <TooltipLabeled side={inward(edge)} label={t('allNotifications')}>
            <button
                type="button"
                data-dock-inbox
                onClick={onOpen}
                aria-label={t('allNotifications')}
                className={cn(
                    'relative flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    active && 'bg-accent text-foreground'
                )}
            >
                <InboxIcon className="size-4" />
                <CountPip count={total} className="absolute -top-0.5 -end-0.5 h-3.5 min-w-3.5 text-[9px]" />
            </button>
        </TooltipLabeled>
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

// How far the resize handles stand out of the rail, above its top and below its bottom.
export const DOCK_RESIZE_HANDLE_OUTSET = 14

type DockResizeEdgeProps = {
    side: 'top' | 'bottom'
    // Shown while the pointer is on its half of the rail, or while it is dragged.
    visible: boolean
    dragging: boolean
    onResizeStart: (side: 'top' | 'bottom', event: ReactPointerEvent<HTMLDivElement>) => void
    onResizeMove: (event: ReactPointerEvent) => void
    onResizeEnd: (event: ReactPointerEvent) => void
    onReset: () => void
}

// A short line of the rail's colour just above or below it: drag it to set how tall the rail may grow,
// a double click lets it grow with its coworkers again.
export function DockResizeEdge({ side, visible, dragging, onResizeStart, onResizeMove, onResizeEnd, onReset }: DockResizeEdgeProps) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('resize')}
            data-dock-resize={side}
            data-visible={visible || dragging}
            data-dragging={dragging}
            onPointerDown={event => onResizeStart(side, event)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            onLostPointerCapture={onResizeEnd}
            onDoubleClick={onReset}
            className={cn(
                'group/resize absolute left-1/2 z-10 flex h-3.5 w-12 -translate-x-1/2 cursor-ns-resize touch-none items-center justify-center opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100',
                side === 'top' ? '-top-3.5' : '-bottom-3.5'
            )}
        >
            <span className="h-[5px] w-5 rounded-full border border-border/60 bg-popover/80 opacity-40 transition-[opacity,background-color] group-hover/resize:bg-accent group-hover/resize:opacity-100 group-data-[dragging=true]/resize:bg-accent group-data-[dragging=true]/resize:opacity-100" />
        </div>
    )
}
