'use client'

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { CoworkerDockCoworker, CoworkerDockEdge } from '@rerun/contracts'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

import { ChevronLeftIcon, ChevronRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CountPip, DockAdd, DockBuddy, DockGrip, DockInbox, pendingTotal, type DockProps } from './DockParts'

const SURFACE = 'border bg-popover/95 text-popover-foreground shadow-xl backdrop-blur'

// Folded, the dock is a tab on the edge: the total of what waits, and a click to unfold it.
function FoldedTab({ coworkers, edge, onToggleCollapsed }: Pick<DockProps, 'coworkers' | 'edge' | 'onToggleCollapsed'>) {
    const t = useTranslations('desktopShell.coworkerDock')
    const total = pendingTotal(coworkers)
    const Chevron = edge === 'right' ? ChevronLeftIcon : ChevronRightIcon
    return (
        <button type="button" onClick={onToggleCollapsed} aria-label={t('show')} className={cn('flex w-6 flex-col items-center gap-1.5 py-3 text-muted-foreground hover:text-foreground', SURFACE, edge === 'right' ? 'rounded-l-xl border-r-0' : 'rounded-r-xl border-l-0')}>
            {total > 0 ? <CountPip count={total} className="ring-0" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
            <Chevron className="size-3.5" />
        </button>
    )
}

type BuddyListProps = Pick<DockProps, 'coworkers' | 'edge' | 'onOpen' | 'onMenu'> & { activeId?: string | null }

// Up and down only: the rail is one buddy wide.
function SortableBuddy({ coworker, edge, active, onOpen, onMenu }: { coworker: CoworkerDockCoworker; edge: CoworkerDockEdge; active: boolean } & Pick<DockProps, 'onOpen' | 'onMenu'>) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: coworker.id, attributes: { role: 'group' } })
    return (
        <div ref={setNodeRef} style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }} {...attributes} {...listeners} className={cn('relative touch-none outline-none', isDragging && 'z-10 cursor-grabbing opacity-80')}>
            <DockBuddy coworker={coworker} edge={edge} active={active} onOpen={onOpen} onMenu={onMenu} />
        </div>
    )
}

// A click still opens the coworker: the drag starts once the pointer has moved a few pixels.
function SortableBuddies({ coworkers, edge, activeId, onOpen, onMenu, onReorder, onDraggingChange }: BuddyListProps & Required<Pick<DockProps, 'onReorder'>> & Pick<DockProps, 'onDraggingChange'>) {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
    const ids = coworkers.map(coworker => coworker.id)
    const end = ({ active, over }: DragEndEvent) => {
        onDraggingChange?.(false)
        if (!over || active.id === over.id) return
        onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
    }
    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => onDraggingChange?.(true)} onDragEnd={end} onDragCancel={() => onDraggingChange?.(false)}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {coworkers.map(coworker => (
                    <SortableBuddy key={coworker.id} coworker={coworker} edge={edge} active={activeId === coworker.id} onOpen={onOpen} onMenu={onMenu} />
                ))}
            </SortableContext>
        </DndContext>
    )
}

/** One rail glued to the edge, a buddy per coworker, the "+" at the bottom. */
export function RailDock({ coworkers, edge, collapsed, createBlockedReason, onOpen, onMenu, onReorder, onDraggingChange, onCreate, onToggleCollapsed, onGrab, inbox }: DockProps) {
    if (collapsed) return <FoldedTab coworkers={coworkers} edge={edge} onToggleCollapsed={onToggleCollapsed} />
    return (
        <div className={cn('flex max-h-full min-h-0 flex-col items-center gap-1 px-1 pt-1 pb-1.5', SURFACE, edge === 'right' ? 'rounded-l-2xl border-r-0' : 'rounded-r-2xl border-l-0')}>
            <DockGrip onGrab={onGrab} onToggleCollapsed={onToggleCollapsed} />
            {inbox && (
                <>
                    <DockInbox edge={edge} total={pendingTotal(coworkers)} active={inbox.active === 'all'} onOpen={inbox.onOpen} />
                    <span className="my-0.5 h-px w-6 shrink-0 bg-border" />
                </>
            )}
            <ScrollFade fadeSize={28} className="min-h-0 overscroll-contain [scrollbar-width:none]">
                <div className="flex flex-col items-center gap-0.5">
                    {onReorder ? (
                        <SortableBuddies coworkers={coworkers} edge={edge} activeId={inbox?.active} onOpen={onOpen} onMenu={onMenu} onReorder={onReorder} onDraggingChange={onDraggingChange} />
                    ) : (
                        coworkers.map(coworker => <DockBuddy key={coworker.id} coworker={coworker} edge={edge} active={inbox?.active === coworker.id} onOpen={onOpen} onMenu={onMenu} />)
                    )}
                </div>
            </ScrollFade>
            <span className="my-0.5 h-px w-6 shrink-0 bg-border" />
            <DockAdd edge={edge} blockedReason={createBlockedReason} onCreate={onCreate} />
        </div>
    )
}
