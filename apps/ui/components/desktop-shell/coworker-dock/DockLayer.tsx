'use client'

import { messagePreview, type CoworkerDockEdge, type CoworkerDockNote } from '@rerun/contracts'
import { ATTENTION_STATUS_META, InboxRow, type InboxEntry } from '@rerun/ui/inbox'
import { Button } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { dockEntryIdOf } from '@/lib/desktop-shell/coworker-dock'
import { stackBubbleTops } from '@/lib/desktop-shell/coworker-dock-notes'
import { ArrowRight, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { DockNoteDetail } from './DockNoteDetail'
import type { DockFilter, DockNotes, DockPanel } from './useDockNotes'

// Where the rail's buttons sit, in pixels from the top of the window: each coworker by id, and the
// button that lists everyone.
export type DockAnchors = { railWidth: number; byId: Record<string, number>; inbox: number }

type Layer = { edge: CoworkerDockEdge; height: number; anchors: DockAnchors }

const CARD = 'border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur'
const GAP = 10
const MARGIN = 16
const BUBBLE_MS = 7000

// Past the room it has, it keeps to the top: the card's header stays reachable.
function clampTop(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max))
}

function inwardStyle(edge: CoworkerDockEdge, anchors: DockAnchors): CSSProperties {
    return edge === 'right' ? { right: anchors.railWidth + GAP } : { left: anchors.railWidth + GAP }
}

// A bubble is a line and two of text: two buddies side by side would have theirs overlap.
const BUBBLE_PITCH = 88
const BUBBLE_MARGIN = 60

const slideFrom = (edge: CoworkerDockEdge) => ({ opacity: 0, x: edge === 'right' ? 14 : -14 })

type DockLayerProps = {
    layer: Layer
    dock: DockNotes
    nameOf: (agentId: string) => string
    onOpenNote: (note: CoworkerDockNote) => void
    onOpenFilter: (filter: DockFilter) => void
    onMarkRead: (note: CoworkerDockNote) => void
    // A bubble or the card moved: the shell is told again where the window takes the pointer.
    onSettled: () => void
}

/** What opens beside the rail, towards the middle of the screen: the bubbles, then the card of notes. */
export function DockLayer({ layer, dock, nameOf, onOpenNote, onOpenFilter, onMarkRead, onSettled }: DockLayerProps) {
    const tops = stackBubbleTops(
        dock.bubbleNotes.map(note => ({ id: note.id, anchor: layer.anchors.byId[dockEntryIdOf(note.agentId)] ?? layer.height / 2 })),
        BUBBLE_PITCH,
        BUBBLE_MARGIN,
        layer.height - BUBBLE_MARGIN
    )
    return (
        <>
            <AnimatePresence onExitComplete={onSettled}>{!dock.panel && dock.bubbleNotes.map(note => <DockBubble key={note.id} note={note} name={nameOf(note.agentId)} top={tops.get(note.id) ?? layer.height / 2} layer={layer} dock={dock} onSettled={onSettled} />)}</AnimatePresence>
            <AnimatePresence onExitComplete={onSettled}>{dock.panel && <DockCard panel={dock.panel} layer={layer} dock={dock} nameOf={nameOf} onOpenNote={onOpenNote} onOpenFilter={onOpenFilter} onMarkRead={onMarkRead} onSettled={onSettled} />}</AnimatePresence>
        </>
    )
}

// It leaves on its own after a while, unless the pointer rests on it.
function useAutoDismiss(onDismiss: () => void) {
    const [hovered, setHovered] = useState(false)
    const dismiss = useRef(onDismiss)
    useEffect(() => {
        dismiss.current = onDismiss
    })
    useEffect(() => {
        if (hovered) return
        const timer = setTimeout(() => dismiss.current(), BUBBLE_MS)
        return () => clearTimeout(timer)
    }, [hovered])
    return { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }
}

function DockBubble({ note, name, top, layer, dock, onSettled }: { note: CoworkerDockNote; name: string; top: number; layer: Layer; dock: DockNotes; onSettled: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    const hover = useAutoDismiss(() => dock.dismissBubble(note.id))
    const meta = ATTENTION_STATUS_META[note.status] ?? ATTENTION_STATUS_META.waiting_human
    return (
        <motion.div
            {...hover}
            data-dock-region
            initial={{ ...slideFrom(layer.edge), y: '-50%' }}
            animate={{ opacity: 1, x: 0, y: '-50%' }}
            exit={{ opacity: 0, scale: 0.96, y: '-50%' }}
            onAnimationComplete={onSettled}
            className="absolute z-20 w-[280px]"
            style={{ top, ...inwardStyle(layer.edge, layer.anchors) }}
        >
            <div className={cn('relative rounded-2xl', CARD)}>
                <button type="button" onClick={() => dock.openPanel(dockEntryIdOf(note.agentId), note)} className="flex w-full flex-col gap-1 rounded-[inherit] py-2.5 pr-8 pl-3 text-left transition-colors hover:bg-accent/60">
                    <span className="text-xs">
                        {t.rich('said', {
                            name,
                            status: note.status,
                            who: chunks => <span className="font-medium text-foreground">{chunks}</span>,
                            verb: chunks => <span className={meta.color}>{chunks}</span>,
                        })}
                    </span>
                    <span className="line-clamp-2 text-sm text-foreground/90">{messagePreview(note.text ?? note.title) || note.title}</span>
                </button>
                <button type="button" aria-label={t('dismiss')} onClick={() => dock.dismissBubble(note.id)} className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <XIcon className="size-3" />
                </button>
            </div>
        </motion.div>
    )
}

function entryOf(note: CoworkerDockNote, agentName: string): InboxEntry {
    return { id: note.id, agentId: note.agentId, agentName, status: note.status, title: note.title, message: note.text ? messagePreview(note.text) || null : null, updatedAt: note.updatedAt, count: note.count }
}

function useHeight<T extends HTMLElement>() {
    const [element, setElement] = useState<T | null>(null)
    const [height, setHeight] = useState(0)
    useLayoutEffect(() => {
        if (!element) return
        const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
        // Its first call comes as soon as it observes.
        observer.observe(element)
        return () => observer.disconnect()
    }, [element])
    return [setElement, height] as const
}

function DockCard({ panel, layer, dock, nameOf, onOpenNote, onOpenFilter, onMarkRead, onSettled }: DockLayerProps & { panel: DockPanel }) {
    const t = useTranslations('desktopShell.coworkerDock')
    const tPeek = useTranslations('notifications.inbox.peek')
    const [ref, height] = useHeight<HTMLDivElement>()
    const note = dock.openNote
    const anchor = panel.filter === 'all' ? layer.anchors.inbox : (layer.anchors.byId[panel.filter] ?? layer.height / 2)
    const top = clampTop(anchor - 34, MARGIN, layer.height - height - MARGIN)

    useEffect(onSettled, [height, onSettled])

    return (
        <motion.div
            ref={ref}
            data-dock-region
            initial={slideFrom(layer.edge)}
            animate={{ opacity: 1, x: 0, top }}
            exit={slideFrom(layer.edge)}
            transition={{ duration: 0.18 }}
            onAnimationComplete={onSettled}
            className={cn('absolute z-20 flex w-[360px] flex-col overflow-hidden rounded-2xl', CARD)}
            style={{ maxHeight: layer.height - MARGIN * 2, ...inwardStyle(layer.edge, layer.anchors) }}
        >
            <StepTransition stepKey={note?.id ?? 'list'} direction={note ? 1 : -1} className="flex min-h-0 flex-1 flex-col">
                {note ? (
                    <DockNoteDetail
                        note={note}
                        name={nameOf(note.agentId)}
                        onBack={() => dock.showNote(null)}
                        onClose={dock.closePanel}
                        onOpenApp={() => onOpenNote(note)}
                        onMarkRead={() => {
                            onMarkRead(note)
                            dock.showNote(null)
                        }}
                        onDone={() => dock.showNote(null)}
                    />
                ) : (
                    <>
                        <div className="flex shrink-0 items-center gap-2 py-2 pr-2 pl-3.5">
                            <span className="flex-1 truncate text-sm font-medium">{panel.filter === 'all' ? t('allCoworkers') : nameOf(panel.filter)}</span>
                            <Button size="icon-sm" variant="ghost" aria-label={tPeek('close')} onClick={dock.closePanel}>
                                <XIcon className="size-3.5" />
                            </Button>
                        </div>
                        {dock.panelNotes.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('nothingWaiting')}</p>
                        ) : (
                            <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain p-1.5 pt-0">
                                {dock.panelNotes.map(item => (
                                    <InboxRow key={item.id} item={entryOf(item, nameOf(item.agentId))} onOpen={() => dock.showNote(item)} onMarkRead={() => onMarkRead(item)} />
                                ))}
                            </div>
                        )}
                        <div className="flex shrink-0 justify-end border-t px-3 py-2">
                            <Button size="sm" variant="ghost" onClick={() => onOpenFilter(panel.filter)}>
                                {t('openInRerun')}
                                <ArrowRight className="size-3.5" />
                            </Button>
                        </div>
                    </>
                )}
            </StepTransition>
        </motion.div>
    )
}
