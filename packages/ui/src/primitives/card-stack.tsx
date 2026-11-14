'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../cn'
import { ChevronLeft, ChevronRight } from '../icons'
import { useKitTranslations } from '../locale'

const DEPTH = 3
const ANGLE = 3
const LIFT = 8
const FLICK = 72
const FLIGHT = 340
const TURN_MS = 5000
const FRONT_SHADOW = 'shadow-[0_16px_36px_-14px_rgba(0,0,0,0.35)] dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)]'
const FANNED_SHADOW = 'shadow-[0_8px_20px_-10px_rgba(0,0,0,0.28)] dark:shadow-[0_10px_26px_-10px_rgba(0,0,0,0.75)]'
const ARROW_CLASS = 'flex size-8 shrink-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground'

const radians = (degrees: number) => (degrees * Math.PI) / 180

export function CardStack({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    const t = useKitTranslations()
    const items = Children.toArray(children)
    const count = items.length
    const [front, setFront] = useState(0)
    const [dealt, setDealt] = useState<{ index: number; direction: 1 | -1 } | null>(null)
    const [recalls, setRecalls] = useState<Record<number, number>>({})
    const [card, setCard] = useState({ width: 0, height: 0 })
    const [turning, setTurning] = useState(true)
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const [dragging, setDragging] = useState(false)
    const draggedRef = useRef(false)
    const observerRef = useRef<ResizeObserver | null>(null)
    const reduceMotion = useReducedMotion() ?? false

    const measureRef = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect()
        if (!node) return
        observerRef.current = new ResizeObserver(([entry]) => setCard({ width: entry.contentRect.width, height: entry.contentRect.height }))
        observerRef.current.observe(node)
    }, [])

    useEffect(() => () => observerRef.current?.disconnect(), [])

    useEffect(() => {
        if (!turning || hovered || focused || dragging || reduceMotion || count < 2) return
        const timer = setTimeout(() => {
            setDealt({ index: front, direction: -1 })
            setFront((front + 1) % count)
        }, TURN_MS)
        return () => clearTimeout(timer)
    }, [turning, hovered, focused, dragging, reduceMotion, count, front])

    if (count === 0) return null

    function deal(direction: 1 | -1) {
        setTurning(false)
        setDealt({ index: front, direction })
        setFront(current => (current + 1) % count)
    }

    function recall() {
        const previous = (front - 1 + count) % count
        setTurning(false)
        setDealt(null)
        if (count - 1 > DEPTH) setRecalls(current => ({ ...current, [previous]: (current[previous] ?? 0) + 1 }))
        setFront(previous)
    }

    const angle = radians(DEPTH * ANGLE)
    const spread = {
        x: (card.height / 2) * Math.sin(angle) + (card.width / 2) * (1 - Math.cos(angle)),
        y: (card.width / 2) * Math.sin(angle) + (card.height / 2) * (1 - Math.cos(angle)),
    }
    const paddingTop = spread.y + DEPTH * LIFT
    const paddingBottom = Math.max(spread.y - DEPTH * LIFT, 0)
    const arrowTop = paddingTop + card.height / 2

    return (
        <div
            role="region"
            aria-label={label}
            className={className}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={() => setFocused(false)}
        >
            <div className="flex items-start gap-1">
                {count > 1 && (
                    <button type="button" aria-label={t('primitives.carousel.previous', { label })} onClick={recall} style={{ marginTop: arrowTop }} className={ARROW_CLASS}>
                        <ChevronLeft className="size-4" />
                    </button>
                )}

                <div
                    className="relative grid min-w-0 flex-1"
                    style={{ paddingTop, paddingBottom, paddingLeft: spread.x, paddingRight: spread.x }}
                >
                    {items.map((item, index) => {
                        const depth = (index - front + count) % count
                        const buried = depth > DEPTH
                        const rank = Math.min(depth, DEPTH)
                        const isFront = depth === 0
                        const leaving = buried && dealt?.index === index
                        const recalled = (recalls[index] ?? 0) > 0

                        return (
                            <motion.div
                                key={`${index}-${recalls[index] ?? 0}`}
                                ref={index === 0 ? measureRef : undefined}
                                initial={recalled ? { x: -FLIGHT, rotate: -8, opacity: 0 } : undefined}
                                className={cn('relative col-start-1 row-start-1 [&_img]:pointer-events-none', buried ? 'pointer-events-none' : !isFront && 'cursor-pointer')}
                                style={{ zIndex: count - depth }}
                                animate={{
                                    x: leaving ? dealt.direction * FLIGHT : 0,
                                    y: leaving ? 0 : -rank * LIFT,
                                    rotate: leaving ? dealt.direction * 8 : rank * ANGLE,
                                    opacity: buried ? 0 : 1 - rank * 0.1,
                                }}
                                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 36, opacity: { duration: 0.25 } }}
                                onAnimationComplete={() => dealt?.index === index && setDealt(null)}
                                drag={isFront && count > 1 ? 'x' : false}
                                dragConstraints={{ left: 0, right: 0 }}
                                dragElastic={0.55}
                                onPointerDown={() => {
                                    draggedRef.current = false
                                }}
                                onDragStart={() => {
                                    draggedRef.current = true
                                    setDragging(true)
                                }}
                                onDragEnd={(_, info) => {
                                    setDragging(false)
                                    if (Math.abs(info.offset.x) >= FLICK) deal(info.offset.x < 0 ? -1 : 1)
                                }}
                                onClickCapture={event => {
                                    if (!draggedRef.current) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                }}
                                onClick={isFront ? undefined : () => deal(1)}
                            >
                                <span aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 rounded-lg bg-card', isFront ? FRONT_SHADOW : FANNED_SHADOW)} />
                                {isFront ? item : <div inert>{item}</div>}
                            </motion.div>
                        )
                    })}
                </div>

                {count > 1 && (
                    <button type="button" aria-label={t('primitives.carousel.next', { label })} onClick={() => deal(-1)} style={{ marginTop: arrowTop }} className={ARROW_CLASS}>
                        <ChevronRight className="size-4" />
                    </button>
                )}
            </div>

            {count > 1 && (
                <div className="mt-4 flex items-center justify-center gap-1.5">
                    {items.map((_, index) => (
                        <button
                            key={index}
                            type="button"
                            aria-label={t('primitives.carousel.goTo', { label, index: index + 1 })}
                            aria-current={index === front}
                            onClick={() => {
                                setTurning(false)
                                setFront(index)
                            }}
                            className={cn('h-1.5 cursor-pointer rounded-full transition-all', index === front ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/25 hover:bg-foreground/40')}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
