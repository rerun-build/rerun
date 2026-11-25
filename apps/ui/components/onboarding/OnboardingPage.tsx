'use client'

import { BrandLogo } from '@/components/brand/BrandLogo'
import { cn } from '@/lib/utils'
import { useScrollFade } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { useState, type ReactNode } from 'react'
import { OnboardingPanel } from './panels/OnboardingPanel'

// The page of the sign-in and of the questions after it: the form on the left half, a panel that
// shows what it leads to on the right, gone under `lg` and where the caller has none. The whole left
// column is one scroller: the block is centered while there is room and nothing is cut when there is
// not. `corner` and the logo stay still while the steps swap; a step that brings its own mark hides
// the logo.
export function OnboardingPage({ stepKey, direction = 1, corner, hideLogo = false, progress, panel, footer, children }: { stepKey: string; direction?: number; corner?: ReactNode; hideLogo?: boolean; progress?: { index: number; count: number }; panel?: ReactNode; footer?: ReactNode; children: ReactNode }) {
    const [column, setColumn] = useState<HTMLElement | null>(null)
    const mask = useScrollFade(column)
    return (
        <div className="flex h-full min-h-0">
            <main ref={setColumn} style={{ maskImage: mask, WebkitMaskImage: mask }} className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                {corner && <div className="flex min-w-0 shrink-0 px-4 pt-4">{corner}</div>}
                <div className="flex flex-1 flex-col items-center px-4 pt-8 pb-[calc(var(--consent-inset)+max(2rem,env(safe-area-inset-bottom)))] sm:px-6">
                    <div className="my-auto flex w-full flex-col items-center gap-4">
                        {!hideLogo && <BrandLogo size="lg" />}
                        {progress && <OnboardingProgress {...progress} />}
                        <StepTransition stepKey={stepKey} direction={direction} className="w-full">
                            {children}
                        </StepTransition>
                    </div>
                    {footer}
                </div>
            </main>
            {panel !== undefined && <OnboardingPanel>{panel}</OnboardingPanel>}
        </div>
    )
}

export function OnboardingHeading({ title, subtitle, mark }: { title: ReactNode; subtitle?: ReactNode; mark?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-4 text-center">
            {mark}
            <div className="space-y-1.5">
                <h1 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">{title}</h1>
                {subtitle && <p className="text-base text-muted-foreground text-balance">{subtitle}</p>}
            </div>
        </div>
    )
}

// One step: its heading, then the card it is answered in, wider for a question than for a form.
export function OnboardingStepLayout({ heading, size = 'form', below, children }: { heading: ReactNode; size?: 'form' | 'question'; below?: ReactNode; children?: ReactNode }) {
    return (
        <div className="flex w-full flex-col items-center gap-8">
            {heading}
            {children && <div className={cn('w-full rounded-2xl bg-card p-5 ring-1 ring-border sm:p-7', size === 'question' ? 'max-w-[34rem]' : 'max-w-[27rem]')}>{children}</div>}
            {below}
        </div>
    )
}

function OnboardingProgress({ index, count }: { index: number; count: number }) {
    return (
        <span aria-hidden className="flex items-center gap-1">
            {Array.from({ length: count }, (_, tick) => (
                <span key={tick} className={cn('h-1 rounded-full transition-all', tick === index ? 'w-6 bg-foreground' : 'w-2 bg-border')} />
            ))}
        </span>
    )
}
