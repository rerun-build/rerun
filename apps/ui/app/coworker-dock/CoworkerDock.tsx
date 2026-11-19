'use client'

import { COWORKER_DOCK_MIN_HEIGHT, type CoworkerDockView } from '@rerun/contracts'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { DockResizeEdge } from '@/components/desktop-shell/coworker-dock/DockParts'
import { RailDock } from '@/components/desktop-shell/coworker-dock/RailDock'
import { desktopShell } from '@/lib/desktop-shell/client'
import { cn } from '@/lib/utils'

// The margin the rail keeps from the top and the bottom of the screen while it follows the pointer,
// the same the shell uses where it is let go.
const DRAG_MARGIN = 40
// A hand that shakes while it clicks or double-clicks the grip does not move the rail.
const DRAG_THRESHOLD_PX = 4

type RailSize = { y: number; maxHeight: number | null }

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
    const railRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
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

    // The shell lets every click outside the rail through to the apps under the window.
    const report = useCallback(() => {
        const rail = railRef.current
        if (!rail) return
        const { x, y, width, height } = rail.getBoundingClientRect()
        dockApi()?.setInteractive(hovering.current || dragging.current, { x, y, width, height })
    }, [])

    const visible = !!view?.state
    useEffect(() => {
        const rail = railRef.current
        if (!visible || !rail) return
        const observer = new ResizeObserver(report)
        observer.observe(rail)
        return () => observer.disconnect()
    }, [visible, report])
    useEffect(report, [report, view, dragY, dragSize])

    const grab = useCallback(
        (event: ReactPointerEvent) => {
            event.preventDefault()
            dragging.current = true
            report()
            let moved = false
            const move = (moving: PointerEvent) => {
                if (!moved && Math.hypot(moving.clientX - event.clientX, moving.clientY - event.clientY) < DRAG_THRESHOLD_PX) return
                moved = true
                setDragY(Math.min(1, Math.max(0, (moving.clientY - DRAG_MARGIN) / Math.max(1, window.innerHeight - DRAG_MARGIN * 2))))
            }
            const release = (released: PointerEvent) => {
                dragging.current = false
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', release)
                if (moved) dockApi()?.drop({ x: released.screenX, y: released.screenY })
                report()
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', release)
        },
        [report]
    )

    // The edge that is not dragged stays where it is: the rail grows or shrinks from the one in hand,
    // as far as its coworkers fill it.
    const grabEdge = useCallback(
        (side: 'top' | 'bottom', event: ReactPointerEvent) => {
            const rail = railRef.current
            const area = rail?.parentElement
            if (!rail || !area) return
            event.preventDefault()
            event.stopPropagation()
            const railBox = rail.getBoundingClientRect()
            const areaBox = area.getBoundingClientRect()
            const scroller = scrollRef.current
            const contentHeight = railBox.height + (scroller ? scroller.scrollHeight - scroller.clientHeight : 0)
            const fixedEdge = side === 'top' ? railBox.bottom : railBox.top
            dragging.current = true
            report()
            let next: RailSize | null = null
            const move = (moving: PointerEvent) => {
                const maxHeight = clamp(side === 'top' ? fixedEdge - moving.clientY : moving.clientY - fixedEdge, COWORKER_DOCK_MIN_HEIGHT, areaBox.height)
                const height = Math.min(contentHeight, maxHeight)
                const top = (side === 'top' ? fixedEdge - height : fixedEdge) - areaBox.top
                next = { y: clamp(top / Math.max(1, areaBox.height - height), 0, 1), maxHeight: Math.round(maxHeight) }
                setDragSize(next)
            }
            const release = () => {
                dragging.current = false
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', release)
                if (next) dockApi()?.resize(next)
                report()
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', release)
        },
        [report]
    )

    if (!view?.state) return <main data-coworker-dock className="h-dvh" />

    const { edge, collapsed } = view
    const y = dragY ?? dragSize?.y ?? view.y
    const maxHeight = dragSize ? dragSize.maxHeight : view.maxHeight
    const resetSize = () => dockApi()?.resize({ y: view.y, maxHeight: null })
    return (
        <main data-coworker-dock className="relative h-dvh overflow-hidden select-none">
            <div className={cn('pointer-events-none absolute top-2 bottom-2', edge === 'right' ? 'right-0' : 'left-0')}>
                <div
                    ref={railRef}
                    className={cn('pointer-events-auto absolute flex max-h-full flex-col', edge === 'right' ? 'right-0' : 'left-0', dragY !== null && 'opacity-90')}
                    style={{ top: `${y * 100}%`, transform: `translateY(-${y * 100}%)`, maxHeight: maxHeight === null ? undefined : `min(${maxHeight}px, 100%)` }}
                    onPointerEnter={() => {
                        hovering.current = true
                        report()
                    }}
                    onPointerLeave={() => {
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
                        scrollRef={scrollRef}
                    />
                    {!collapsed && (
                        <>
                            <DockResizeEdge side="top" onGrab={event => grabEdge('top', event)} onReset={resetSize} />
                            <DockResizeEdge side="bottom" onGrab={event => grabEdge('bottom', event)} onReset={resetSize} />
                        </>
                    )}
                </div>
            </div>
        </main>
    )
}
