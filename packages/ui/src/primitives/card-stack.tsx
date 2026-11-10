'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../cn'
import { ChevronLeft, ChevronRight } from '../icons'
import { useKitTranslations } from '../locale'

// Cards fanned out behind the front one. A deeper fan buys angle rather than information.
const DEPTH = 3
// Degrees and pixels each card behind steps by. Rotation alone slides one top corner out and
// tucks the other in, so the lift is what brings the whole edge above the card in front.
const ANGLE = 3
const LIFT = 8
// Drag past this and the top card is dealt away instead of settling back into the fan.
const FLICK = 72
// How far out of the box a card travels, on its way out and on its way back.
const FLIGHT = 340
// How long a card holds the front on its own, once nobody is touching the hand.
const TURN_MS = 5000
// The depth under a card. Two settings, because a black shadow over a near black surface is close
// to nothing: the dark theme needs its own, far heavier, to read at all.
const FRONT_SHADOW = 'shadow-[0_16px_36px_-14px_rgba(0,0,0,0.35)] dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)]'
const FANNED_SHADOW = 'shadow-[0_8px_20px_-10px_rgba(0,0,0,0.28)] dark:shadow-[0_10px_26px_-10px_rgba(0,0,0,0.75)]'
// Flat, and beside the hand rather than over it: an arrow floating on the front card would sit on
// the artwork and steal the click that opens it.
const ARROW_CLASS = 'flex size-8 shrink-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground'

const radians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * A hand of cards, dealt one at a time: the front card sits square and the ones behind it fan out
 * to its upper left. Flick the top card aside, click an edge, or use the arrows and dots under it.
 * The hand loops, so there is no end to walk back from.
 */
export function CardStack({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    const t = useKitTranslations()
    const items = Children.toArray(children)
    const count = items.length
    const [front, setFront] = useState(0)
    // The card that just left the front, and the side it went out on: it keeps flying that way
    // while it fades, rather than sliding back to centre under the fan.
    const [dealt, setDealt] = useState<{ index: number; direction: 1 | -1 } | null>(null)
    // How many times each card has been called back to the front. A card that has already flown out
    // waits back at centre, invisible, so bringing it back means remounting it off to the side and
    // letting it fly in: the count is what changes its key. Counting per card rather than keeping
    // one "arriving" card leaves every other card mounted, and its animation running.
    const [recalls, setRecalls] = useState<Record<number, number>>({})
    // The size of a card, measured: the room the fan needs around it and the height the arrows sit
    // level with both follow from it, and reserving a guessed value would lay the fan over the
    // heading above it.
    const [card, setCard] = useState({ width: 0, height: 0 })
    // The hand turns by itself until the reader takes it over, and holds still while they are on it.
    const [turning, setTurning] = useState(true)
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)
    const [dragging, setDragging] = useState(false)
    const draggedRef = useRef(false)
    const observerRef = useRef<ResizeObserver | null>(null)
    const reduceMotion = useReducedMotion() ?? false

    // Every card shares the one grid cell, so the first one measures them all. It is measured
    // through a ref rather than once on mount because calling it back to the front remounts it, and
    // an observer left on the node it replaced reports nothing: the fan would lose its room.
    const measureRef = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect()
        if (!node) return
        observerRef.current = new ResizeObserver(([entry]) => setCard({ width: entry.contentRect.width, height: entry.contentRect.height }))
        observerRef.current.observe(node)
    }, [])

    useEffect(() => () => observerRef.current?.disconnect(), [])

    // A timer per card rather than one interval: taking a card by hand restarts the count instead
    // of leaving the next turn to fire on whatever was left of the previous one.
    useEffect(() => {
        if (!turning || hovered || focused || dragging || reduceMotion || count < 2) return
        const timer = setTimeout(() => {
            setDealt({ index: front, direction: -1 })
            setFront((front + 1) % count)
        }, TURN_MS)
        return () => clearTimeout(timer)
    }, [turning, hovered, focused, dragging, reduceMotion, count, front])

    if (count === 0) return null

    // Every way in here is a reader taking the hand over, which is the end of it turning on its
    // own: a deck that keeps dealing under someone who is picking their own card fights them.
    function deal(direction: 1 | -1) {
        setTurning(false)
        setDealt({ index: front, direction })
        setFront(current => (current + 1) % count)
    }

    // The other way round: the card that left comes back in from the side it went out on, and the
    // hand it was covering slides back under it. A hand short enough that nothing is ever buried
    // has that card still in the fan, and it walks up from there instead of flying in.
    function recall() {
        const previous = (front - 1 + count) % count
        setTurning(false)
        setDealt(null)
        if (count - 1 > DEPTH) setRecalls(current => ({ ...current, [previous]: (current[previous] ?? 0) + 1 }))
        setFront(previous)
    }

    // How far the last card of the fan reaches past the front one on each side, which is the room
    // the fan turns in.
    const angle = radians(DEPTH * ANGLE)
    const spread = {
        x: (card.height / 2) * Math.sin(angle) + (card.width / 2) * (1 - Math.cos(angle)),
        y: (card.width / 2) * Math.sin(angle) + (card.height / 2) * (1 - Math.cos(angle)),
    }
    // The fan needs more room above the front card than below it, so the middle of the box is not
    // the middle of the card: the arrows are placed on the card's own centre line instead.
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

                {/* One grid cell holds every card, so the box is the height of a single one and the
                    fan never moves a neighbour. The padding is the room the fan turns in. */}
                <div
                    className="relative grid min-w-0 flex-1"
                    style={{ paddingTop, paddingBottom, paddingLeft: spread.x, paddingRight: spread.x }}
                >
                    {items.map((item, index) => {
                        const depth = (index - front + count) % count
                        const buried = depth > DEPTH
                        // Everything deeper than the last card of the fan waits at its place, invisible,
                        // and fades in as the hand brings it up.
                        const rank = Math.min(depth, DEPTH)
                        const isFront = depth === 0
                        const leaving = buried && dealt?.index === index
                        const recalled = (recalls[index] ?? 0) > 0

                        return (
                            <motion.div
                                key={`${index}-${recalls[index] ?? 0}`}
                                ref={index === 0 ? measureRef : undefined}
                                initial={recalled ? { x: -FLIGHT, rotate: -8, opacity: 0 } : undefined}
                                // Images out of the hit test: the browser starts their own native drag
                                // before ours and swaps the card for a ghost of the picture.
                                className={cn('relative col-start-1 row-start-1 [&_img]:pointer-events-none', buried ? 'pointer-events-none' : !isFront && 'cursor-pointer')}
                                style={{ zIndex: count - depth }}
                                animate={{
                                    x: leaving ? dealt.direction * FLIGHT : 0,
                                    y: leaving ? 0 : -rank * LIFT,
                                    rotate: leaving ? dealt.direction * 8 : rank * ANGLE,
                                    opacity: buried ? 0 : 1 - rank * 0.1,
                                }}
                                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 36, opacity: { duration: 0.25 } }}
                                // Once it is out of sight, drop the exit so the card can drift back to
                                // centre before the hand loops round to it again.
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
                                // A drag that ends on the card still lands as a click on the button
                                // inside it, which would open what the reader was only pushing aside.
                                onClickCapture={event => {
                                    if (!draggedRef.current) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                }}
                                onClick={isFront ? undefined : () => deal(1)}
                            >
                                {/* A card is free to answer a hover with a translucent tint, which is
                                    harmless in a grid and not here: what shows through is the card
                                    underneath. This gives every card its own opaque backing. */}
                                <span aria-hidden className={cn('pointer-events-none absolute inset-0 -z-10 rounded-lg bg-card', isFront ? FRONT_SHADOW : FANNED_SHADOW)} />
                                {/* Only the front card is live: the fan is decor, and the button each of
                                    its cards wraps would otherwise be a tab stop on a covered card. */}
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
