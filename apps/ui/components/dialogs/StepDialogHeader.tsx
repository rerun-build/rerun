'use client'

import { TextGenerateEffect } from '@rerun/ui'
import { StepperBar, StepTransition, type StepperGroup, type StepperSplit } from '@rerun/ui/steps'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function StepDialogHeader({
    count,
    index,
    direction,
    title,
    description,
    split,
    groups,
    stepKey,
    variant = 'compact',
    className,
}: {
    count: number
    index: number
    direction: number
    title?: string
    description?: string
    split?: StepperSplit
    groups?: readonly StepperGroup[]
    stepKey?: string | number
    variant?: 'compact' | 'hero'
    className?: string
}) {
    const hero = variant === 'hero'

    return (
        <DialogHeader className={cn(hero ? 'mb-6 sm:mb-9' : 'mb-4', className)}>
            <StepperBar count={count} current={index} split={split} groups={groups} className={hero ? 'mb-6 sm:mb-10' : 'mb-4'} />
            <StepTransition stepKey={stepKey ?? index} direction={direction} variant="header" className={cn(hero && 'flex min-h-[5.5rem] flex-col items-center gap-2.5 px-4 text-center sm:min-h-[6.75rem]')}>
                {title && (
                    <DialogTitle className={cn(hero && 'text-2xl leading-tight font-semibold text-balance sm:text-3xl')}>
                        {hero ? <TextGenerateEffect key={title} text={title} duration={0.4} delay={0.12} /> : title}
                    </DialogTitle>
                )}
                {description && (
                    <DialogDescription className={cn(hero && 'max-w-md text-sm text-balance line-clamp-2 sm:text-base')}>
                        {hero ? <TextGenerateEffect key={description} text={description} duration={0.55} delay={0.45} stagger={0.028} blur={5} /> : description}
                    </DialogDescription>
                )}
            </StepTransition>
        </DialogHeader>
    )
}
