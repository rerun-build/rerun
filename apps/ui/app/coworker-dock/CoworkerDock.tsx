'use client'

import { COWORKER_DOCK_MIN_HEIGHT, type CoworkerDockNote, type CoworkerDockRect, type CoworkerDockView } from '@rerun/contracts'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { DockLayer, type DockAnchors } from '@/components/desktop-shell/coworker-dock/DockLayer'
import { DOCK_RESIZE_HANDLE_OUTSET, DockResizeEdge } from '@/components/desktop-shell/coworker-dock/DockParts'
import { RailDock } from '@/components/desktop-shell/coworker-dock/RailDock'
import { useDockNotes, type DockFilter } from '@/components/desktop-shell/coworker-dock/useDockNotes'
import { desktopShell } from '@/lib/desktop-shell/client'
import { isForemanDockEntry } from '@/lib/desktop-shell/coworker-dock'
import { cn } from '@/lib/utils'
import { installWorkspaceHeader, pinTabWorkspace } from '@/lib/workspace/tab-workspace'

// The dock's window is no tab of the app: its requests name the main window's workspace, which it pins
// as it is published, or they would follow the one picked last anywhere else.
installWorkspaceHeader()

// A hand that shakes while it clicks or double-clicks the grip does not move the rail.
const DRAG_THRESHOLD_PX = 4

type RailSize = { y: number; maxHeight: number | null }
type EdgeSide = 'top' | 'bottom'
// `anchor`: how far the edge that stays put is from the same side of the area, in pixels.
type EdgeDrag = { side: EdgeSide; anchor: number; maxHeight: number }
type EdgeResize = { pointerId: number; side: EdgeSide; startY: number; startHeight: number; room: number; moved: boolean; maxHeight: number }

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function dockApi() {
    return desktopShell('coworkerDock')?.coworkerDock ?? null
}

// A shell that keeps the person's order: older ones show the coworkers as the main window sends them.
function reorderApi() {
    const dock = desktopShell('coworkerDockArrange')?.coworkerDock
    return dock?.reorder ? (agentIds: string[]) => dock.reorder?.(agentIds) : null
}

// The order a drag left, shown until the shell sends the view it saved.
function inOrder<C extends { id: string }>(coworkers: C[], order: string[] | null): C[] {
    if (!order) return coworkers
    const rank = new Map(order.map((id, index) => [id, index]))
    return [...coworkers].sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length))
}

const contains = (rect: CoworkerDockRect, point: { x: number; y: number }) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height

function rectOf(element: Element, outset = 0): CoworkerDockRect {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y: y - outset, width, height: height + outset * 2 }
}

// Where each buddy and the inbox button stand, so a bubble or the card opens level with them.
function measureAnchors(rail: HTMLElement): DockAnchors {
    const middle = (element: Element | null) => {
        if (!element) return 0
        const box = element.getBoundingClientRect()
        return box.top + box.height / 2
    }
    // A buddy scrolled out of the rail is pointed at from the rail's end.
    const { top, bottom } = rail.getBoundingClientRect()
    const byId: Record<string, number> = {}
    for (const element of rail.querySelectorAll('[data-coworker]')) byId[element.getAttribute('data-coworker') ?? ''] = Math.min(Math.max(middle(element), top), bottom)
    return { railWidth: rail.offsetWidth, byId, inbox: middle(rail.querySelector('[data-dock-inbox]')) }
}

/** The desktop app's coworker dock: a window as tall as the screen, glued to its edge, where only the rail, its bubbles and its card take the pointer. Its top and bottom edges set how tall it may grow. */
export function CoworkerDock() {
    const [view, setView] = useState<CoworkerDockView | null>(null)
    // The shells that predate the notes keep the dock of before: a count, and a click that opens the app.
    const [withNotes, setWithNotes] = useState(false)
    const dock = useDockNotes(withNotes ? view?.state?.notes : undefined)
    const [layer, setLayer] = useState<{ height: number; anchors: DockAnchors } | null>(null)
    const mainRef = useRef<HTMLElement>(null)
    const pointer = useRef<{ x: number; y: number } | null>(null)
    const sent = useRef('')
    const [dragY, setDragY] = useState<number | null>(null)
    const [dragSize, setDragSize] = useState<RailSize | null>(null)
    const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null)
    const [hoveredHalf, setHoveredHalf] = useState<EdgeSide | null>(null)
    const [droppedOrder, setDroppedOrder] = useState<string[] | null>(null)
    const railRef = useRef<HTMLDivElement>(null)
    const hovering = useRef(false)
    const dragging = useRef(false)

    useEffect(() => {
        const api = dockApi()
        if (!api) return
        setWithNotes(desktopShell('coworkerDockNotes') !== null)
        void api.get().then(next => next && setView(next))
        return api.onChange(next => {
            setDragY(null)
            setDragSize(null)
            setDroppedOrder(null)
            setView(next)
        })
    }, [])

    // The shell lets every click outside the rail and its resize handles, the bubbles and the card through
    // to the apps under the window.
    const report = useCallback(() => {
        const rail = railRef.current
        const api = dockApi()
        if (!rail || !api) return
        const railRect = rectOf(rail, rail.querySelector('[data-dock-resize]') ? DOCK_RESIZE_HANDLE_OUTSET : 0)
        if (!api.setInteractiveRegions || !desktopShell('coworkerDockNotes')) return api.setInteractive(hovering.current || dragging.current, railRect)
        const opened = [...(mainRef.current?.querySelectorAll('[data-dock-region]') ?? [])].map(element => rectOf(element))
        const at = pointer.current
        const interactive = hovering.current || dragging.current || (at !== null && opened.some(rect => contains(rect, at)))
        const rects = [railRect, ...opened]
        const key = JSON.stringify([interactive, rects])
        if (key === sent.current) return
        sent.current = key
        api.setInteractiveRegions(interactive, rects)
    }, [])

    // The window gets the pointer's moves even while it lets the clicks through: they say when the
    // pointer comes over a bubble or the card.
    useEffect(() => {
        if (!withNotes) return
        const move = (event: PointerEvent) => {
            pointer.current = { x: event.clientX, y: event.clientY }
            report()
        }
        const leave = () => {
            pointer.current = null
            report()
        }
        window.addEventListener('pointermove', move)
        document.documentElement.addEventListener('pointerleave', leave)
        return () => {
            window.removeEventListener('pointermove', move)
            document.documentElement.removeEventListener('pointerleave', leave)
        }
    }, [withNotes, report])

    const visible = !!view?.state
    useEffect(() => {
        const rail = railRef.current
        if (!visible || !rail) return
        const observer = new ResizeObserver(report)
        observer.observe(rail)
        return () => observer.disconnect()
    }, [visible, report])
    useEffect(report, [report, view, dragY, dragSize, edgeDrag, dock.panel, dock.bubbleNotes])

    const opened = dock.panel !== null || dock.bubbleNotes.length > 0
    const measure = useCallback(() => {
        const rail = railRef.current
        const main = mainRef.current
        if (!rail || !main) return
        const next = { height: main.clientHeight, anchors: measureAnchors(rail) }
        setLayer(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }, [])
    useLayoutEffect(() => {
        const rail = railRef.current
        if (!opened || !rail) return
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(rail)
        rail.addEventListener('scroll', measure, true)
        window.addEventListener('resize', measure)
        return () => {
            observer.disconnect()
            rail.removeEventListener('scroll', measure, true)
            window.removeEventListener('resize', measure)
        }
    }, [opened, measure, view, dragY, dragSize, edgeDrag, droppedOrder])

    // The card has fields: the window takes the keys while it is open, and Escape puts it away.
    const cardOpen = dock.panel !== null
    const { closePanel } = dock
    const folded = view?.collapsed === true
    useEffect(() => {
        if (folded) closePanel()
    }, [folded, closePanel])
    useEffect(() => {
        if (!withNotes) return
        dockApi()?.setFocusable?.(cardOpen)
        if (!cardOpen) return
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePanel()
        }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [withNotes, cardOpen, closePanel])

    const workspaceKey = view?.state?.workspaceKey
    useEffect(() => {
        const workspaceId = Number(workspaceKey)
        if (Number.isSafeInteger(workspaceId) && workspaceId > 0) pinTabWorkspace(workspaceId)
    }, [workspaceKey])

    // A note the card still shows may have left the inbox already (answered, read elsewhere): the
    // main window no longer knows it, its coworker's conversation opens instead.
    const openNote = useCallback(
        (note: CoworkerDockNote) => {
            if (dock.notes.some(item => item.id === note.id)) dockApi()?.openNote?.(note.id)
            else dockApi()?.open(note.agentId)
            closePanel()
        },
        [closePanel, dock.notes]
    )
    const openFilter = useCallback(
        (filter: DockFilter) => {
            const agentId = filter === 'all' ? (dock.notes[0]?.agentId ?? view?.state?.coworkers.find(coworker => !isForemanDockEntry(coworker))?.id) : filter
            if (agentId) dockApi()?.open(agentId)
            closePanel()
        },
        [closePanel, dock.notes, view]
    )
    const markRead = useCallback((note: CoworkerDockNote) => dockApi()?.markRead?.(note.id), [])

    // The grip stays under the pointer: the rail moves by as much as the pointer does, within the edge.
    const grab = useCallback(
        (event: ReactPointerEvent) => {
            const rail = railRef.current
            const area = rail?.parentElement
            if (!rail || !area) return
            event.preventDefault()
            const railBox = rail.getBoundingClientRect()
            const areaBox = area.getBoundingClientRect()
            const startTop = railBox.top - areaBox.top
            const travel = areaBox.height - railBox.height
            dragging.current = true
            report()
            let moved = false
            let railY: number | null = null
            const move = (moving: PointerEvent) => {
                if (!moved && Math.hypot(moving.clientX - event.clientX, moving.clientY - event.clientY) < DRAG_THRESHOLD_PX) return
                moved = true
                railY = travel > 0 ? clamp(startTop + moving.clientY - event.clientY, 0, travel) / travel : 0
                setDragY(railY)
            }
            const release = (released: PointerEvent) => {
                dragging.current = false
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', release)
                if (moved) dockApi()?.drop({ x: released.screenX, y: released.screenY, railY: railY ?? undefined })
                report()
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', release)
        },
        [report]
    )

    // The edge that is not dragged stays on its pixel: the rail is anchored to it while the other one
    // follows the pointer, and goes back to its fraction of the screen once the shell has its new place.
    const resizeRef = useRef<EdgeResize | null>(null)
    const startResize = useCallback(
        (side: EdgeSide, event: ReactPointerEvent<HTMLDivElement>) => {
            const rail = railRef.current
            const area = rail?.parentElement
            if (!rail || !area) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            const railBox = rail.getBoundingClientRect()
            const areaBox = area.getBoundingClientRect()
            const anchor = side === 'top' ? areaBox.bottom - railBox.bottom : railBox.top - areaBox.top
            const room = side === 'top' ? railBox.bottom - areaBox.top : areaBox.bottom - railBox.top
            resizeRef.current = { pointerId: event.pointerId, side, startY: event.clientY, startHeight: railBox.height, room, moved: false, maxHeight: railBox.height }
            dragging.current = true
            setEdgeDrag({ side, anchor, maxHeight: railBox.height })
            report()
        },
        [report]
    )

    const moveResize = useCallback((event: ReactPointerEvent) => {
        const resize = resizeRef.current
        if (!resize || resize.pointerId !== event.pointerId) return
        const delta = event.clientY - resize.startY
        if (!resize.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return
        resize.moved = true
        const maxHeight = clamp(resize.startHeight + (resize.side === 'top' ? -delta : delta), COWORKER_DOCK_MIN_HEIGHT, resize.room)
        resize.maxHeight = maxHeight
        setEdgeDrag(current => current && { ...current, maxHeight })
    }, [])

    const finishResize = useCallback(
        (event: ReactPointerEvent) => {
            const resize = resizeRef.current
            if (!resize || resize.pointerId !== event.pointerId) return
            resizeRef.current = null
            dragging.current = false
            const rail = railRef.current
            const area = rail?.parentElement
            if (resize.moved && rail && area) {
                const railBox = rail.getBoundingClientRect()
                const areaBox = area.getBoundingClientRect()
                const next = { y: clamp((railBox.top - areaBox.top) / Math.max(1, areaBox.height - railBox.height), 0, 1), maxHeight: Math.round(resize.maxHeight) }
                setDragSize(next)
                dockApi()?.resize(next)
            }
            setEdgeDrag(null)
            report()
        },
        [report]
    )

    if (!view?.state) return <main data-coworker-dock className="h-dvh" />

    const { edge, collapsed } = view
    const coworkers = view.state.coworkers
    const nameOf = (agentId: string) => coworkers.find(coworker => coworker.id === agentId)?.name ?? ''
    const y = dragY ?? dragSize?.y ?? view.y
    const maxHeight = edgeDrag?.maxHeight ?? (dragSize ? dragSize.maxHeight : view.maxHeight)
    const position = edgeDrag ? { [edgeDrag.side === 'top' ? 'bottom' : 'top']: `${edgeDrag.anchor}px` } : { top: `${y * 100}%`, transform: `translateY(-${y * 100}%)` }
    const resetSize = () => dockApi()?.resize({ y: view.y, maxHeight: null })
    const reorder = reorderApi()
    const draggingBuddy = (active: boolean) => {
        dragging.current = active
        report()
    }
    return (
        <main ref={mainRef} data-coworker-dock className="relative h-dvh overflow-hidden select-none">
            <div className={cn('pointer-events-none absolute top-4 bottom-4', edge === 'right' ? 'right-0' : 'left-0')}>
                <div
                    ref={railRef}
                    className={cn('pointer-events-auto absolute flex max-h-full flex-col', edge === 'right' ? 'right-0' : 'left-0', dragY !== null && 'opacity-90')}
                    style={{ ...position, maxHeight: maxHeight === null ? undefined : `min(${maxHeight}px, 100%)` }}
                    onPointerEnter={() => {
                        hovering.current = true
                        report()
                    }}
                    onPointerMove={event => {
                        const box = event.currentTarget.getBoundingClientRect()
                        const half = event.clientY < box.top + box.height / 2 ? 'top' : 'bottom'
                        if (half !== hoveredHalf) setHoveredHalf(half)
                    }}
                    onPointerLeave={() => {
                        setHoveredHalf(null)
                        hovering.current = false
                        report()
                    }}
                    onContextMenu={event => {
                        event.preventDefault()
                        dockApi()?.showMenu()
                    }}
                >
                    <RailDock
                        coworkers={inOrder(view.state.coworkers, droppedOrder)}
                        edge={edge}
                        collapsed={collapsed}
                        createBlockedReason={view.state.createBlockedReason}
                        onOpen={coworker => (withNotes && !isForemanDockEntry(coworker) ? dock.togglePanel(coworker.id) : dockApi()?.open(coworker.id))}
                        onMenu={coworker => dockApi()?.showMenu(coworker.id)}
                        onReorder={
                            reorder
                                ? agentIds => {
                                      setDroppedOrder(agentIds)
                                      reorder(agentIds)
                                  }
                                : undefined
                        }
                        onDraggingChange={draggingBuddy}
                        inbox={withNotes ? { active: dock.panel?.filter ?? null, onOpen: () => dock.togglePanel('all') } : undefined}
                        onCreate={() => dockApi()?.create()}
                        onToggleCollapsed={() => dockApi()?.setCollapsed(!collapsed)}
                        onGrab={grab}
                    />
                    {!collapsed && (
                        <>
                            <DockResizeEdge side="top" visible={hoveredHalf === 'top'} dragging={edgeDrag?.side === 'top'} onResizeStart={startResize} onResizeMove={moveResize} onResizeEnd={finishResize} onReset={resetSize} />
                            <DockResizeEdge side="bottom" visible={hoveredHalf === 'bottom'} dragging={edgeDrag?.side === 'bottom'} onResizeStart={startResize} onResizeMove={moveResize} onResizeEnd={finishResize} onReset={resetSize} />
                        </>
                    )}
                </div>
            </div>
            {withNotes && !collapsed && layer && <DockLayer layer={{ edge, ...layer }} dock={dock} nameOf={nameOf} onOpenNote={openNote} onOpenFilter={openFilter} onMarkRead={markRead} onSettled={report} />}
        </main>
    )
}
