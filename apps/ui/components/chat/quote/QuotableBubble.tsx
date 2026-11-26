'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

import { useQuoteReplyContext, type QuoteSide } from '@/components/chat/quote/useQuoteReply'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ReplyIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// The swipe quotes once pulled this far, and resists past the second distance.
const SWIPE_ARMED = 56
const SWIPE_FREE = 72
const SWIPE_RESISTANCE = 0.2
// Under this the finger has not said yet whether it scrolls or swipes.
const SWIPE_DECIDE = 6

type QuotableBubbleProps = {
    side: QuoteSide
    children: ReactNode
    /** On the bubble's own box, the one the swipe moves: its width cap. */
    bubbleClassName?: string
}

// One bubble, quoted on its own: with a mouse, the round icon beside it (right of the coworker's,
// left of the person's); on a touch screen, a swipe to the right.
export function QuotableBubble({ side, children, bubbleClassName }: QuotableBubbleProps) {
    const reply = useQuoteReplyContext()
    const bubbleRef = useRef<HTMLDivElement>(null)
    const quote = () => bubbleRef.current && reply?.quoteBubble(bubbleRef.current)
    const swipe = useSwipeToQuote(quote)
    const isUser = side === 'user'
    const hover = reply && <HoverReply onClick={quote} />

    return (
        <div className={cn('group/bubble relative flex w-full min-w-0 items-center gap-1', isUser ? 'justify-end' : 'justify-start')}>
            {reply && <SwipeHint progress={swipe.offset / SWIPE_ARMED} />}
            {isUser && hover}
            <div
                ref={bubbleRef}
                className={cn('flex min-w-0', isUser && 'justify-end', reply && '[@media(pointer:coarse)]:touch-pan-y', bubbleClassName)}
                style={swipe.offset || swipe.dragging ? { transform: `translateX(${swipe.offset}px)`, transition: swipe.dragging ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1)' } : undefined}
                {...(reply ? swipe.handlers : {})}
            >
                {children}
            </div>
            {!isUser && hover}
        </div>
    )
}

function HoverReply({ onClick }: { onClick: () => void }) {
    const t = useTranslations('chat.quote')
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        data-message-actions=""
                        aria-label={t('replyToBubble')}
                        onClick={onClick}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/bubble:opacity-100 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:hidden"
                    >
                        <ReplyIcon className="size-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent>{t('replyToBubble')}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

// Behind the bubble, at the start of the row: the arrow grows with the swipe and turns brand once armed.
function SwipeHint({ progress }: { progress: number }) {
    if (progress <= 0) return null
    const shown = Math.min(progress, 1)
    return (
        <div aria-hidden className="pointer-events-none absolute start-1 top-1/2" style={{ opacity: shown, transform: `translateY(-50%) scale(${0.6 + shown * 0.4})` }}>
            <div className={cn('flex size-7 items-center justify-center rounded-full transition-colors', progress >= 1 ? 'bg-brand text-brand-ink' : 'bg-muted text-muted-foreground')}>
                <ReplyIcon className="size-3.5" />
            </div>
        </div>
    )
}

// Touch only: a mouse drag over a bubble selects its text. A vertical move leaves the page scrolling,
// and the click a finished swipe ends on does not select the message under it.
function useSwipeToQuote(onQuote: () => void) {
    const [offset, setOffset] = useState(0)
    const [dragging, setDragging] = useState(false)
    const start = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)
    const armed = useRef(false)
    const swiped = useRef(false)

    const reset = () => {
        start.current = null
        setDragging(false)
        setOffset(0)
    }

    const handlers = {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (event.pointerType !== 'touch' || (event.target as HTMLElement).closest('button, a')) return
            start.current = { x: event.clientX, y: event.clientY, horizontal: null }
            armed.current = false
            swiped.current = false
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            const origin = start.current
            if (!origin) return
            const dx = event.clientX - origin.x
            const dy = event.clientY - origin.y
            if (origin.horizontal === null && Math.hypot(dx, dy) > SWIPE_DECIDE) {
                origin.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy)
                if (!origin.horizontal) return reset()
                event.currentTarget.setPointerCapture(event.pointerId)
                setDragging(true)
            }
            if (!origin.horizontal) return
            const pulled = Math.max(0, dx)
            const next = pulled <= SWIPE_FREE ? pulled : SWIPE_FREE + (pulled - SWIPE_FREE) * SWIPE_RESISTANCE
            if (next >= SWIPE_ARMED && !armed.current) navigator.vibrate?.(8)
            armed.current = next >= SWIPE_ARMED
            setOffset(next)
        },
        onPointerUp: () => {
            if (start.current?.horizontal) {
                swiped.current = true
                if (armed.current) onQuote()
            }
            reset()
        },
        onPointerCancel: reset,
        onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
            if (!swiped.current) return
            swiped.current = false
            event.stopPropagation()
        },
    }

    return { offset, dragging, handlers }
}
