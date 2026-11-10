'use client'

import { ChromePill } from '@rerun/ui/chrome'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

import { GettingStartedPanel, GettingStartedProgressMark, type OnGettingStartedStep } from '@/components/foreman/getting-started/GettingStartedPanel'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { doneCount, stepsOf, type GettingStartedState } from '@/lib/onboarding/getting-started'

type GettingStartedPopoverProps = GettingStartedState & {
    open: boolean
    onOpenChange: (open: boolean) => void
    onStep: OnGettingStartedStep
    onHide: () => void
    /** Bumped each time a step lands live: the pill sends out one ring to say so. */
    pulse?: number
}

const HOVER_CLOSE_DELAY_MS = 150

/**
 * Board furniture, in the corner and in the workspace pill's material: the checklist belongs to the
 * workspace, not to the Foreman it hands every step to. A mouse opens it by hovering, a finger by tapping.
 */
export function GettingStartedPopover({ progress, reward, open, onOpenChange, onStep, onHide, pulse = 0 }: GettingStartedPopoverProps) {
    const t = useTranslations('foreman.gettingStarted')
    const reducedMotion = useReducedMotion()
    const done = doneCount(progress)
    const total = stepsOf(progress).length
    const complete = done === total

    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const openedByHover = useRef(false)
    const cancelClose = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current)
        closeTimer.current = null
    }
    useEffect(() => cancelClose, [])
    useEffect(() => {
        if (!open) openedByHover.current = false
    }, [open])
    const openOnHover = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return
        cancelClose()
        if (open) return
        openedByHover.current = true
        onOpenChange(true)
    }
    // The click that follows a hover would toggle the list shut right as it appeared.
    const keepHoverOpen = (event: MouseEvent) => {
        if (!openedByHover.current) return
        openedByHover.current = false
        event.preventDefault()
    }
    // The gap between the pill and the panel is crossed on the way in, so leaving one only closes
    // once the pointer has not landed on the other.
    const closeOnLeave = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return
        cancelClose()
        closeTimer.current = setTimeout(() => {
            openedByHover.current = false
            onOpenChange(false)
        }, HOVER_CLOSE_DELAY_MS)
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <ChromePill
                    start="gauge"
                    beamTone="brand"
                    beamAnimated={!complete}
                    aria-label={t('pillLabel', { done, total })}
                    onPointerEnter={openOnHover}
                    onPointerLeave={closeOnLeave}
                    onClick={keepHoverOpen}
                >
                    {pulse > 0 && !reducedMotion && (
                        <motion.span
                            key={pulse}
                            aria-hidden
                            initial={{ opacity: 0.8, scale: 1 }}
                            animate={{ opacity: 0, scale: 1.25 }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className="pointer-events-none absolute inset-0 rounded-full border border-brand"
                        />
                    )}
                    <GettingStartedProgressMark progress={progress} className="relative" />
                    <span className="relative tabular-nums">
                        {done}/{total}
                    </span>
                </ChromePill>
            </PopoverTrigger>
            <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                onPointerEnter={openOnHover}
                onPointerLeave={closeOnLeave}
                onOpenAutoFocus={event => event.preventDefault()}
                className="w-80"
            >
                <GettingStartedPanel progress={progress} reward={reward} onStep={onStep} onHide={onHide} />
            </PopoverContent>
        </Popover>
    )
}
