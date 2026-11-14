'use client'

import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

import type { DiscoveryEntry } from '@/lib/company/explore/findings'
import { cn } from '@/lib/utils'
import { DiscoveryCard } from './DiscoveryCard'

export type FindingEntry = Extract<DiscoveryEntry, { type: 'finding' }>

const PEEK = 10
const GAP = 8
const SCALE_STEP = 0.05
const BURIED_SHOWN = 2

const SPRING: Transition = { type: 'spring', stiffness: 320, damping: 30 }
const INSTANT: Transition = { duration: 0 }

type Placement = { depth: number; offset: number; frontHeight: number; expanded: boolean }

function target({ depth, offset, frontHeight, expanded }: Placement, height: number) {
    if (expanded) return { y: -offset, scale: 1, opacity: 1, height: height || 'auto' }
    if (depth === 0) return { y: 0, scale: 1, opacity: 1, height: height || 'auto' }
    return { y: -depth * PEEK, scale: 1 - depth * SCALE_STEP, opacity: depth > BURIED_SHOWN ? 0 : 1, height: frontHeight }
}

function StackedCard({
    entry,
    placement,
    height,
    zIndex,
    still,
    onHeight,
}: {
    entry: FindingEntry
    placement: Placement
    height: number
    zIndex: number
    still: boolean
    onHeight: (id: string, height: number) => void
}) {
    const contentRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        const content = contentRef.current
        if (!content) return
        onHeight(entry.id, content.offsetHeight)
        const observer = new ResizeObserver(() => onHeight(entry.id, content.offsetHeight))
        observer.observe(content)
        return () => observer.disconnect()
    }, [entry.id, onHeight])

    const buried = placement.depth > 0 && !placement.expanded

    return (
        <motion.div
            className={cn('absolute inset-x-0 bottom-0', buried && 'overflow-hidden rounded-xl')}
            style={{ zIndex, originY: 0 }}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.92, filter: 'blur(6px)' }}
            animate={{ ...target(placement, height), filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.96, filter: still ? 'blur(0px)' : 'blur(4px)' }}
            transition={still ? INSTANT : SPRING}
        >
            <div ref={contentRef}>
                <DiscoveryCard finding={entry.finding} still={still} />
            </div>
        </motion.div>
    )
}

export function DiscoveryStack({ entries, still, className }: { entries: FindingEntry[]; still: boolean; className?: string }) {
    const [expanded, setExpanded] = useState(false)
    const [heights, setHeights] = useState<Record<string, number>>({})

    const onHeight = useCallback((id: string, height: number) => setHeights(current => (current[id] === height ? current : { ...current, [id]: height })), [])

    const cards = [...entries].sort((a, b) => b.arrival - a.arrival)
    const heightOf = (entry: FindingEntry | undefined) => (entry ? (heights[entry.id] ?? 0) : 0)
    const frontHeight = heightOf(cards[0])
    const offsets = cards.reduce<number[]>((acc, card, index) => [...acc, index ? acc[index - 1] + heightOf(cards[index - 1]) + GAP : 0], [])
    const expandedHeight = cards.length ? offsets[cards.length - 1] + heightOf(cards.at(-1)) : 0
    const collapsedHeight = frontHeight + PEEK * Math.min(cards.length - 1, BURIED_SHOWN)
    const open = expanded && cards.length > 1

    const toggleOnTouch = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') setExpanded(value => !value)
    }

    if (!cards.length) return null

    return (
        <div
            className={cn('pointer-events-auto box-content flex max-h-[calc(100%-6rem)] flex-col-reverse p-6', open && 'no-scrollbar overflow-y-auto', className)}
            onPointerEnter={event => event.pointerType === 'mouse' && setExpanded(true)}
            onPointerLeave={event => event.pointerType === 'mouse' && setExpanded(false)}
            onPointerDown={toggleOnTouch}
        >
            <motion.div className="relative w-full shrink-0" initial={false} animate={{ height: open ? expandedHeight : collapsedHeight }} transition={still ? INSTANT : SPRING}>
                <AnimatePresence initial={false}>
                    {cards.map((card, depth) => (
                        <StackedCard
                            key={card.id}
                            entry={card}
                            placement={{ depth, offset: offsets[depth], frontHeight, expanded: open }}
                            height={heightOf(card)}
                            zIndex={cards.length - depth}
                            still={still}
                            onHeight={onHeight}
                        />
                    ))}
                </AnimatePresence>
            </motion.div>
        </div>
    )
}
