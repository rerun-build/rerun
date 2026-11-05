'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon } from '@/lib/icons'

const SWIPE_THRESHOLD_PX = 40

export function SlideStage({ slides }: { slides: ReactNode[] }) {
    const [index, setIndex] = useState(0)
    const swipeStart = useRef<number | null>(null)
    const count = slides.length

    const go = useCallback((delta: number) => setIndex(current => Math.min(count - 1, Math.max(0, current + delta))), [count])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return
            if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') go(1)
            else if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(-1)
            else if (event.key === 'Home') setIndex(0)
            else if (event.key === 'End') setIndex(count - 1)
            else return
            event.preventDefault()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [count, go])

    return (
        <div
            className="flex h-full touch-pan-y flex-col items-center justify-center gap-4 bg-[#0b0b0c] p-6 select-none max-md:p-3 max-md:pb-16"
            onPointerDown={event => {
                swipeStart.current = event.clientX
            }}
            onPointerUp={event => {
                if (swipeStart.current === null) return
                const delta = event.clientX - swipeStart.current
                swipeStart.current = null
                if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) go(delta < 0 ? 1 : -1)
            }}
        >
            <div className="flex min-h-0 w-full max-w-[860px] flex-1 items-center justify-center [container-type:size]">{slides[index]}</div>
            <div className="flex shrink-0 items-center gap-2 text-white/70">
                <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10 hover:text-white" aria-label="Previous slide" disabled={index === 0} onClick={() => go(-1)}>
                    <ChevronLeftIcon />
                </Button>
                <span className="font-mono text-xs tabular-nums" aria-live="polite">
                    {index + 1} / {count}
                </span>
                <Button variant="ghost" size="icon-sm" className="text-white/70 hover:bg-white/10 hover:text-white" aria-label="Next slide" disabled={index === count - 1} onClick={() => go(1)}>
                    <ChevronRightIcon />
                </Button>
            </div>
        </div>
    )
}
