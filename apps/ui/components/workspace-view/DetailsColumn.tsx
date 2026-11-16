'use client'

import { motion, useReducedMotion } from 'motion/react'
import { type CSSProperties, type ReactNode, useRef, useState } from 'react'

import { SidePanelResizeHandle } from '@/components/layout/SidePanelResizeHandle'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useDetailsBesideChat } from '@/components/workspace-view/useDetailsOpen'
import { isTypingTarget } from '@/lib/typing-target'
import { DETAILS_COLUMN_WIDTH } from '@/lib/workspace-view'
import { cn } from '@/lib/utils'

type DetailsColumnProps = {
    label: string
    open: boolean
    // Mounted by a click rather than with the page: it slides in instead of being there already.
    slideIn: boolean
    onClose: () => void
    children: ReactNode
}

const SLIDE = { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.22 } as const

/**
 * The right column of the Simple view, beside whoever holds the middle. From `xl` it sits beside the
 * chat and its left edge resizes it; under `xl` it is a Sheet over the chat.
 *
 * Beside the chat it stays mounted once opened, so opening it again draws nothing new. It moves by its
 * transform alone: the chat takes its new width once, as the column starts to slide in or once it has
 * slid out, never on every frame of the slide.
 */
export function DetailsColumn({ label, open, slideIn, onClose, children }: DetailsColumnProps) {
    const columnRef = useRef<HTMLElement>(null)
    const reducedMotion = useReducedMotion()
    const besideChat = useDetailsBesideChat()
    // Holds the column's room until it has slid out.
    const [inFlow, setInFlow] = useState(open)
    if (open && !inFlow) setInFlow(true)

    if (!besideChat) {
        // The page's colour, as beside the chat: the sticky headings of the lists inside are painted with it.
        return (
            <Sheet open={open} onOpenChange={next => !next && onClose()}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    aria-describedby={undefined}
                    onEscapeKeyDown={event => isTypingTarget(event.target) && event.preventDefault()}
                    className="gap-0 bg-background p-0 data-[side=right]:w-[calc(100%-3rem)] data-[side=right]:sm:max-w-[400px]"
                >
                    <SheetTitle className="sr-only">{label}</SheetTitle>
                    {children}
                </SheetContent>
            </Sheet>
        )
    }

    return (
        <motion.aside
            aria-label={label}
            aria-hidden={!open || undefined}
            inert={!open}
            ref={columnRef}
            initial={slideIn ? { x: '100%' } : false}
            animate={{ x: open ? 0 : '100%' }}
            transition={reducedMotion ? { duration: 0 } : SLIDE}
            onAnimationComplete={() => !open && setInFlow(false)}
            style={{ '--details-width': `${DETAILS_COLUMN_WIDTH.defaultWidth}px` } as CSSProperties}
            className={cn('relative flex w-(--details-width) max-w-[45vw] shrink-0 flex-col border-l border-border bg-background will-change-transform', !inFlow && 'hidden')}
        >
            <SidePanelResizeHandle panelRef={columnRef} config={DETAILS_COLUMN_WIDTH} widthVar="--details-width" className="-left-2" />
            {children}
        </motion.aside>
    )
}
