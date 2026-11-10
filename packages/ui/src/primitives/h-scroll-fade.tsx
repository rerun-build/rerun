'use client'

import { cn } from '../cn'
import { useKitTranslations } from '../locale'
import { ChevronLeft, ChevronRight } from '../icons'
import { useCallback, useEffect, useRef, useState } from 'react'

// Horizontal scroll row with edge fades + arrows that appear only in the directions you can still
// scroll. The fade color must match the surface behind it (e.g. `from-popover` inside a dialog).
export function HScrollFade({ children, className, fadeClassName = 'from-popover' }: { children: React.ReactNode; className?: string; fadeClassName?: string }) {
    const ref = useRef<HTMLDivElement>(null)
    const [canLeft, setCanLeft] = useState(false)
    const [canRight, setCanRight] = useState(false)

    const update = useCallback(() => {
        const el = ref.current
        if (!el) return
        setCanLeft(el.scrollLeft > 1)
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }, [])

    useEffect(() => {
        const el = ref.current
        if (!el) return
        update()
        el.addEventListener('scroll', update, { passive: true })
        const observer = new ResizeObserver(update)
        observer.observe(el)
        return () => {
            el.removeEventListener('scroll', update)
            observer.disconnect()
        }
    }, [update])

    // One child plus the gap, so a row of cards advances by a card rather than by a third of one.
    // Floored at the old fixed step: a row of pills would otherwise crawl one pill at a time.
    const scrollBy = (dir: -1 | 1) => {
        const el = ref.current
        if (!el) return
        const child = el.firstElementChild as HTMLElement | null
        const gap = parseFloat(getComputedStyle(el).columnGap) || 0
        el.scrollBy({ left: dir * Math.max(160, child ? child.clientWidth + gap : 0), behavior: 'smooth' })
    }

    return (
        <div className="relative">
            <div ref={ref} className={cn('no-scrollbar flex gap-2 overflow-x-auto', className)}>
                {children}
            </div>
            {canLeft && <Edge side="left" fadeClassName={fadeClassName} onClick={() => scrollBy(-1)} />}
            {canRight && <Edge side="right" fadeClassName={fadeClassName} onClick={() => scrollBy(1)} />}
        </div>
    )
}

function Edge({ side, fadeClassName, onClick }: { side: 'left' | 'right'; fadeClassName: string; onClick: () => void }) {
    const t = useKitTranslations()
    const isLeft = side === 'left'
    return (
        <div className={cn('pointer-events-none absolute inset-y-0 z-10 flex w-12 items-center to-transparent', fadeClassName, isLeft ? 'left-0 justify-start bg-gradient-to-r' : 'right-0 justify-end bg-gradient-to-l')}>
            <button
                type="button"
                onClick={onClick}
                aria-label={isLeft ? t('primitives.scrollLeft') : t('primitives.scrollRight')}
                className="pointer-events-auto flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-foreground"
            >
                {isLeft ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
        </div>
    )
}
