'use client'

import { COWORKER_DOCK_MIN_HEIGHT, type CoworkerDockView } from '@rerun/contracts'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { DOCK_RESIZE_HANDLE_OUTSET, DockResizeEdge } from '@/components/desktop-shell/coworker-dock/DockParts'
import { RailDock } from '@/components/desktop-shell/coworker-dock/RailDock'
import { desktopShell } from '@/lib/desktop-shell/client'
import { cn } from '@/lib/utils'

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

/** The desktop app's coworker dock: a window as tall as the screen, glued to its edge, where only the rail takes the pointer. Its top and bottom edges set how tall it may grow. */
export function CoworkerDock() {
    const [view, setView] = useState<CoworkerDockView | null>(null)
    const [dragY, setDragY] = useState<number | null>(null)
    const [dragSize, setDragSize] = useState<RailSize | null>(null)
    const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null)
    const [hoveredHalf, setHoveredHalf] = useState<EdgeSide | null>(null)
    const railRef = useRef<HTMLDivElement>(null)
    const hovering = useRef(false)
    const dragging = useRef(false)

    useEffect(() => {
        const dock = dockApi()
        if (!dock) return
        void dock.get().then(next => next && setView(next))
        return dock.onChange(next => {
            setDragY(null)
            setDragSize(null)
            setView(next)
        })
    }, [])

    // The shell lets every click outside the rail and its resize handles through to the apps under the window.
    const report = useCallback(() => {
        const rail = railRef.current
        if (!rail) return
        const { x, y, width, height } = rail.getBoundingClientRect()
        const outset = rail.querySelector('[data-dock-resize]') ? DOCK_RESIZE_HANDLE_OUTSET : 0
        dockApi()?.setInteractive(hovering.current || dragging.current, { x, y: y - outset, width, height: height + outset * 2 })
    }, [])

    const visible = !!view?.state
    useEffect(() => {
        const rail = railRef.current
        if (!visible || !rail) return
        const observer = new ResizeObserver(report)
        observer.observe(rail)
        return () => observer.disconnect()
    }, [visible, report])
    useEffect(report, [report, view, dragY, dragSize, edgeDrag])

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
    const y = dragY ?? dragSize?.y ?? view.y
    const maxHeight = edgeDrag?.maxHeight ?? (dragSize ? dragSize.maxHeight : view.maxHeight)
    const position = edgeDrag ? { [edgeDrag.side === 'top' ? 'bottom' : 'top']: `${edgeDrag.anchor}px` } : { top: `${y * 100}%`, transform: `translateY(-${y * 100}%)` }
    const resetSize = () => dockApi()?.resize({ y: view.y, maxHeight: null })
    return (
        <main data-coworker-dock className="relative h-dvh overflow-hidden select-none">
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
                        coworkers={view.state.coworkers}
                        edge={edge}
                        collapsed={collapsed}
                        createBlockedReason={view.state.createBlockedReason}
                        onOpen={coworker => dockApi()?.open(coworker.id)}
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
        </main>
    )
}
