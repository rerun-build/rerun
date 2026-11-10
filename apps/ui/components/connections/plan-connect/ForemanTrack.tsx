'use client'

import { Orb, type OrbActivity } from '@rerun/ui/foreman'
import { LayoutGroup, motion } from 'motion/react'
import { useId, type ReactNode } from 'react'

import { ExplainerCheck } from '@/components/dialogs/ExplainerPanel'
import { cn } from '@/lib/utils'

// `remark` is what the Foreman says once the plan is linked and it stands on this step.
export type TrackStep = { title: ReactNode; body?: ReactNode; remark?: ReactNode }

type StepStatus = 'done' | 'active' | 'next'

type ForemanTrackProps = {
    steps: [TrackStep, TrackStep, TrackStep]
    // The step the Foreman stands on, and how many steps above the line are behind the user.
    at: number
    done: number
    orb: OrbActivity
    remark: ReactNode
    thinking?: boolean
}

// The Foreman is the cursor of the stepper: it walks down the line to the step that needs the user,
// and says one line there. The line runs from one dot to the next: it starts under the dot (28px,
// the Orb is 32px) and reaches 8px into the next row, where its dot sits.
export function ForemanTrack({ steps, at, done, orb, remark, thinking = false }: ForemanTrackProps) {
    const group = useId()

    const cursor = (
        <motion.span layoutId={`${group}-foreman`} transition={{ type: 'spring', stiffness: 260, damping: 26 }} className="relative z-10 flex">
            <Orb size={32} state={orb} facing="right" />
        </motion.span>
    )
    const bubble = (
        <motion.p key={typeof remark === 'string' ? remark : `step-${at}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex w-fit items-center gap-2 rounded-2xl rounded-tl-md bg-muted px-3 py-1.5 text-xs">
            {remark}
            {thinking && <TypingDots className="text-muted-foreground" />}
        </motion.p>
    )

    return (
        <LayoutGroup id={group}>
            <ol className="flex flex-col">
                {steps.map((step, index) => (
                    <Row key={index} index={index} status={index < done ? 'done' : index === at ? 'active' : 'next'} here={index === at} cursor={cursor} bubble={bubble} step={step} last={index === steps.length - 1} />
                ))}
            </ol>
        </LayoutGroup>
    )
}

type RowProps = { index: number; status: StepStatus; here: boolean; cursor: ReactNode; bubble: ReactNode; step: TrackStep; last: boolean }

function Row({ index, status, here, cursor, bubble, step, last }: RowProps) {
    const muted = status === 'next'
    return (
        <li className="relative flex gap-3 pb-8 last:pb-0">
            {!last && <span className={cn('absolute -bottom-2 left-4 w-0.5 -translate-x-1/2 rounded-full transition-colors duration-500', here ? 'top-8' : 'top-7', status === 'done' ? 'bg-brand dark:bg-[color-mix(in_oklab,var(--brand),white_25%)]' : 'bg-border')} />}
            <span className="flex w-8 shrink-0 justify-center">
                {here ? (
                    cursor
                ) : (
                    <span className="pt-1.5">
                        <StepDot index={index} status={status} />
                    </span>
                )}
            </span>
            <div className={cn('flex min-w-0 flex-1 flex-col gap-2', !here && 'pt-1.5')}>
                {here && bubble}
                <p className={cn('text-sm font-medium', muted && 'text-muted-foreground')}>{step.title}</p>
                {step.body && <div className={cn('transition-opacity', muted && 'opacity-60')}>{step.body}</div>}
            </div>
        </li>
    )
}

function StepDot({ index, status }: { index: number; status: StepStatus }) {
    if (status === 'done') return <ExplainerCheck />
    return (
        <span className={cn('relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors', status === 'active' ? 'bg-foreground text-background ring-4 ring-foreground/10' : 'bg-muted text-muted-foreground')}>
            {index + 1}
        </span>
    )
}

function TypingDots({ className }: { className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1', className)}>
            {[0, 1, 2].map(index => (
                <span key={index} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${index * 140}ms` }} />
            ))}
        </span>
    )
}
