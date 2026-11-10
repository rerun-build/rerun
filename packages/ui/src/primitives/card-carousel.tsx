'use client'

import { Children, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../cn'
import { ChevronLeft, ChevronRight } from '../icons'
import { useKitTranslations } from '../locale'

const FADE_CLASS = 'pointer-events-none absolute -top-2 -bottom-10 z-20 w-24 transition-opacity duration-200'
const ARROW_CLASS =
    'absolute top-1/2 z-30 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-background text-foreground/70 shadow-[0_1px_2px_rgb(16_24_40/0.08),0_6px_16px_-6px_rgb(16_24_40/0.25)] ring-1 ring-foreground/10 transition hover:text-foreground hover:shadow-[0_1px_2px_rgb(16_24_40/0.1),0_10px_22px_-8px_rgb(16_24_40/0.35)]'
const DEFAULT_ITEM_CLASS = 'w-[85%] shrink-0 snap-center sm:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)]'

// Snapping row of cards with edge fades and round arrows that only show in the directions you can
// still scroll. `fadeClassName` is the gradient start and must match the surface behind the row.
// The scroller bleeds past the row (1rem on the sides, 2.5rem below where the shadows fall) so its
// overflow does not clip the cards' shadows.
export function CardCarousel({
    label,
    itemClassName = DEFAULT_ITEM_CLASS,
    fadeClassName = 'from-background',
    className,
    dots = false,
    children,
}: {
    label: string
    itemClassName?: string
    fadeClassName?: string
    className?: string
    /** Pagination dots under the row, one per card. */
    dots?: boolean
    children: ReactNode
}) {
    const t = useKitTranslations()
    const scrollerRef = useRef<HTMLDivElement>(null)
    const [canLeft, setCanLeft] = useState(false)
    const [canRight, setCanRight] = useState(false)
    const [active, setActive] = useState(0)
    const count = Children.count(children)

    // One card plus the gap: the distance an arrow travels, and the unit the dots index on.
    function step(el: HTMLDivElement): number {
        const card = el.firstElementChild as HTMLElement | null
        const gap = parseFloat(getComputedStyle(el).columnGap) || 0
        return card ? card.clientWidth + gap : el.clientWidth
    }

    function updatePosition() {
        const el = scrollerRef.current
        if (!el) return
        setCanLeft(el.scrollLeft > 8)
        setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
        setActive(Math.round(el.scrollLeft / step(el)))
    }

    useEffect(() => {
        updatePosition()
        window.addEventListener('resize', updatePosition)
        return () => window.removeEventListener('resize', updatePosition)
    }, [])

    function scrollByCard(direction: 1 | -1) {
        const el = scrollerRef.current
        if (!el) return
        el.scrollBy({ left: direction * step(el), behavior: 'smooth' })
    }

    // Dots land on the snap point itself rather than on `index * step`: with centred items the two
    // are a half-card apart, and the browser would smooth-scroll to the wrong place and then yank
    // the row back when it re-snaps. Both ends stay clamped by the scroller, as snapping would.
    function scrollToCard(index: number) {
        const el = scrollerRef.current
        if (!el) return
        const card = el.firstElementChild as HTMLElement | null
        const centered = card ? getComputedStyle(card).scrollSnapAlign.startsWith('center') : false
        const inset = card && centered ? (el.clientWidth - card.clientWidth) / 2 : 0
        el.scrollTo({ left: index * step(el) - inset, behavior: 'smooth' })
    }

    return (
        <div role="region" aria-label={label}>
            <div className="relative">
                <div
                    ref={scrollerRef}
                    onScroll={updatePosition}
                    className={cn('-mx-4 -mt-2 -mb-10 flex snap-x snap-mandatory scroll-px-4 gap-6 overflow-x-auto px-4 pt-2 pb-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
                >
                    {Children.map(children, child => (
                        <div className={itemClassName}>{child}</div>
                    ))}
                </div>

                <div aria-hidden className={cn(FADE_CLASS, '-left-4 bg-gradient-to-r to-transparent', fadeClassName, canLeft ? 'opacity-100' : 'opacity-0')} />
                <div aria-hidden className={cn(FADE_CLASS, '-right-4 bg-gradient-to-l to-transparent', fadeClassName, canRight ? 'opacity-100' : 'opacity-0')} />

                <button
                    type="button"
                    aria-label={t('primitives.carousel.previous', { label })}
                    onClick={() => scrollByCard(-1)}
                    className={cn(ARROW_CLASS, 'left-1 sm:left-0 sm:-translate-x-1/2', canLeft ? 'opacity-100' : 'pointer-events-none opacity-0')}
                >
                    <ChevronLeft className="size-4" />
                </button>
                <button
                    type="button"
                    aria-label={t('primitives.carousel.next', { label })}
                    onClick={() => scrollByCard(1)}
                    className={cn(ARROW_CLASS, 'right-1 sm:right-0 sm:translate-x-1/2', canRight ? 'opacity-100' : 'pointer-events-none opacity-0')}
                >
                    <ChevronRight className="size-4" />
                </button>
            </div>

            {dots && count > 1 && (
                <div className="relative mt-4 flex items-center justify-center gap-1.5">
                    {Array.from({ length: count }).map((_, index) => (
                        <button
                            key={index}
                            type="button"
                            aria-label={t('primitives.carousel.goTo', { label, index: index + 1 })}
                            aria-current={index === active}
                            onClick={() => scrollToCard(index)}
                            className={cn('h-1.5 cursor-pointer rounded-full transition-all', index === active ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/25 hover:bg-foreground/40')}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
