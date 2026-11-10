'use client'

import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { cn } from '@/lib/utils'
import { sweepIntensity } from '@rerun/contracts'

const CELL = { size: 10, gap: 3, radius: 2.5 }
const COMPACT_CELL = { size: 6, gap: 2, radius: 1.5 }
const OPACITY_STEPS = 6
const PEAK_OPACITY = 0.09
const FRAME_INTERVAL_MS = 1000 / 30
const STILL_FRAME_INTERVAL_MS = 1000
const STILL_FRAME_SECONDS = 4
const LABEL_CLEARING = 'radial-gradient(ellipse 20rem 8rem at 50% 50%, transparent 40%, black 100%)'

type DesktopScreenLoaderProps = {
    label?: string
    // The corner preview is a few hundred pixels wide: smaller cells keep it a grid.
    compact?: boolean
    // The screen has arrived and fades in over the loader, which fades out under it.
    fading?: boolean
    className?: string
}

export function DesktopScreenLoader({ label, compact = false, fading = false, className }: DesktopScreenLoaderProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const still = useReducedMotion() ?? false
    const [fadedOut, setFadedOut] = useState(false)
    const running = !(fading && fadedOut)

    useEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context || !running) return

        const cell = compact ? COMPACT_CELL : CELL
        const pitch = cell.size + cell.gap
        // Live: it follows the theme without a listener.
        const style = getComputedStyle(canvas)
        let width = 0
        let height = 0
        let cols = 0
        let rows = 0
        let steps = new Uint8Array(0)

        const draw = () => {
            const seconds = still ? STILL_FRAME_SECONDS : performance.now() / 1000
            for (let col = 0; col < cols; col++) {
                for (let row = 0; row < rows; row++) {
                    steps[col * rows + row] = Math.round(sweepIntensity(col, row, seconds, cols, rows) * OPACITY_STEPS)
                }
            }
            // The grid is centred and bleeds past the edges, which cut the outer cells.
            const left = (width - (cols * pitch - cell.gap)) / 2
            const top = (height - (rows * pitch - cell.gap)) / 2
            context.clearRect(0, 0, width, height)
            context.fillStyle = style.color
            for (let step = 1; step <= OPACITY_STEPS; step++) {
                context.beginPath()
                for (let col = 0; col < cols; col++) {
                    for (let row = 0; row < rows; row++) {
                        if (steps[col * rows + row] === step) context.roundRect(left + col * pitch, top + row * pitch, cell.size, cell.size, cell.radius)
                    }
                }
                context.globalAlpha = (step / OPACITY_STEPS) * PEAK_OPACITY
                context.fill()
            }
        }

        const measure = () => {
            const ratio = window.devicePixelRatio || 1
            width = canvas.clientWidth
            height = canvas.clientHeight
            canvas.width = Math.round(width * ratio)
            canvas.height = Math.round(height * ratio)
            context.setTransform(ratio, 0, 0, ratio, 0, 0)
            cols = Math.ceil(width / pitch) + 1
            rows = Math.ceil(height / pitch) + 1
            steps = new Uint8Array(cols * rows)
            draw()
        }

        const interval = still ? STILL_FRAME_INTERVAL_MS : FRAME_INTERVAL_MS
        let frame = 0
        let drawnAt = 0
        const tick = (now: number) => {
            if (now - drawnAt >= interval) {
                drawnAt = now
                draw()
            }
            frame = requestAnimationFrame(tick)
        }

        const observer = new ResizeObserver(measure)
        observer.observe(canvas)
        frame = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
        }
    }, [compact, still, running])

    return (
        <div
            aria-hidden={!label}
            onTransitionEnd={event => {
                if (event.target === event.currentTarget) setFadedOut(fading)
            }}
            className={cn('pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden text-foreground transition-opacity duration-300', fading && 'opacity-0', className)}
        >
            <canvas ref={canvasRef} className="absolute inset-0 size-full" style={label ? { maskImage: LABEL_CLEARING } : undefined} />
            {label && (
                <Shimmer as="span" duration={1.6} className="relative text-sm">
                    {label}
                </Shimmer>
            )}
        </div>
    )
}
