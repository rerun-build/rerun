'use client'

import { animate, motion, useDragControls, useMotionValue, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { TakeControlOverlay } from '@/components/desktop/TakeControlOverlay'
import { cn } from '@/lib/utils'

export type ScreenSide = 'left' | 'right'

const SIDE_STORAGE_KEY = 'rerun:chat-screen-side'
const WIDTH_STORAGE_KEY = 'rerun:chat-screen-width'
const DEFAULT_WIDTH = 200
const MIN_WIDTH = 160
const MAX_WIDTH = 360
const LANDING = { type: 'spring', stiffness: 500, damping: 38 } as const
const ENTER_EASE = [0.22, 1, 0.36, 1] as const

function loadSide(): ScreenSide {
    try {
        return localStorage.getItem(SIDE_STORAGE_KEY) === 'left' ? 'left' : 'right'
    } catch {
        return 'right'
    }
}

function loadWidth(): number {
    try {
        const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
        return stored ? clampWidth(stored, Infinity) : DEFAULT_WIDTH
    } catch {
        return DEFAULT_WIDTH
    }
}

function remember(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {}
}

const clampWidth = (width: number, trackWidth: number) => Math.min(MAX_WIDTH, trackWidth, Math.max(MIN_WIDTH, width))

type FloatingScreenProps = {
    takeControlLabel: string
    children: ReactNode
    onTakeControl: () => void
    // Where the edge it slides along sits, under the pills and tabs of the chat it floats over.
    className?: string
}

// The screen the thread scrolled away from, kept at the top of the chat under its pills and tabs. It slides
// along that edge only: let go, it lands on the nearer side and stays there. Its inner bottom corner resizes it.
export function FloatingScreen({ takeControlLabel, children, onTakeControl, className }: FloatingScreenProps) {
    const t = useTranslations('desktop.screen')
    const reducedMotion = useReducedMotion()
    const dragControls = useDragControls()
    const trackRef = useRef<HTMLDivElement>(null)
    const [side, setSide] = useState<ScreenSide>(loadSide)
    const [width, setWidth] = useState(loadWidth)
    const sideRef = useRef(side)
    const x = useMotionValue(0)
    const draggedRef = useRef(false)
    const resizeRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

    const restOf = (target: ScreenSide) => (target === 'left' ? 0 : Math.max(0, (trackRef.current?.clientWidth ?? width) - width))

    // Set before paint, so the thumbnail never shows on the wrong side for a frame, and keeps its
    // outer edge where it was while its width changes.
    useLayoutEffect(() => {
        const track = trackRef.current
        if (!track) return
        x.set(restOf(sideRef.current))
        const observer = new ResizeObserver(() => x.set(restOf(sideRef.current)))
        observer.observe(track)
        return () => observer.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width])

    const land = () => {
        const track = trackRef.current
        if (!track) return
        const next: ScreenSide = x.get() + width / 2 < track.clientWidth / 2 ? 'left' : 'right'
        sideRef.current = next
        setSide(next)
        remember(SIDE_STORAGE_KEY, next)
        animate(x, restOf(next), reducedMotion ? { duration: 0 } : LANDING)
    }

    const startResize = (event: PointerEvent<HTMLDivElement>) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizeRef.current = { startX: event.clientX, startWidth: width, width }
    }

    const resize = (event: PointerEvent<HTMLDivElement>) => {
        const start = resizeRef.current
        if (!start) return
        const pulled = event.clientX - start.startX
        const grown = side === 'right' ? start.startWidth - pulled : start.startWidth + pulled
        start.width = clampWidth(grown, trackRef.current?.clientWidth ?? Infinity)
        setWidth(start.width)
    }

    const endResize = () => {
        const resized = resizeRef.current
        if (!resized) return
        resizeRef.current = null
        remember(WIDTH_STORAGE_KEY, String(resized.width))
    }

    const takeControlUnlessDragged = () => {
        const dragged = draggedRef.current
        draggedRef.current = false
        if (!dragged) onTakeControl()
    }

    return (
        <div ref={trackRef} className={cn('pointer-events-none absolute inset-x-3 z-40 h-0', className)}>
            <motion.div
                drag="x"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={trackRef}
                dragElastic={0.06}
                dragMomentum={false}
                onPointerDown={event => {
                    draggedRef.current = false
                    dragControls.start(event)
                }}
                onDragStart={() => {
                    draggedRef.current = true
                }}
                onDragEnd={land}
                style={{ x, width, transformOrigin: side === 'left' ? 'top left' : 'top right' }}
                initial={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }}
                transition={{ duration: 0.28, ease: ENTER_EASE }}
                className="group pointer-events-auto absolute top-0 left-0 flex aspect-video cursor-grab touch-none overflow-hidden rounded-lg shadow-xl ring-1 ring-border active:cursor-grabbing"
            >
                {children}
                <TakeControlOverlay label={takeControlLabel} onClick={takeControlUnlessDragged} />
                <div
                    role="separator"
                    aria-label={t('resize')}
                    onPointerDown={startResize}
                    onPointerMove={resize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    className={cn('absolute bottom-0 flex size-6 items-end p-1.5 opacity-0 transition-opacity group-hover:opacity-100', side === 'right' ? 'left-0 cursor-nesw-resize justify-start' : 'right-0 cursor-nwse-resize justify-end')}
                >
                    <span className={cn('size-2.5 border-b-2 border-white/90 drop-shadow', side === 'right' ? 'rounded-bl-[3px] border-l-2' : 'rounded-br-[3px] border-r-2')} />
                </div>
            </motion.div>
        </div>
    )
}
