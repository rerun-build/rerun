'use client'

import { AuthScene } from '@/components/auth/AuthScene'
import { StepSwap } from '@/components/onboarding/StepSwap'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Logo } from '@rerun/ui/logo'
import type { ReactNode } from 'react'

const keepOpen = (event: Event) => event.preventDefault()

// The one dialog of the sign-in and of the questions after it, over the app's backdrop. Each change
// of `stepKey` plays in three beats (fade out, resize, fade in). The page that renders it keeps its
// state outside of it, so the dialog can step aside for the billing dialog or the waitlist wall and
// come back without losing anything.
export function OnboardingDialog({ open = true, stepKey, children }: { open?: boolean; stepKey: string; children: ReactNode }) {
    return (
        <Dialog open={open} dismissible={false}>
            <DialogContent
                showCloseButton={false}
                className="gap-0 overflow-x-hidden bg-background p-0 sm:w-[min(92vw,34rem)] sm:max-w-none sm:rounded-2xl"
                onEscapeKeyDown={keepOpen}
                onPointerDownOutside={keepOpen}
                onInteractOutside={keepOpen}
            >
                <div className="relative isolate overflow-hidden">
                    {/* The decor frames itself on its box: following the dialog's height, it would
                        zoom in and out on every step. A fixed stage, centered, keeps the camera
                        still while the dialog only crops more or less of it. */}
                    <div className="absolute inset-x-0 top-1/2 h-[48rem] -translate-y-1/2">
                        <AuthScene variant="dialog" />
                    </div>
                    <StepSwap stepKey={stepKey} innerClassName="relative z-10 px-6 pt-10 pb-[max(2rem,env(safe-area-inset-bottom))]">
                        <div className="mx-auto w-full max-w-sm">{children}</div>
                    </StepSwap>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// The header of every step: the logo centered (or the Chief of Staff's orb once it wakes up), a large
// title, its line under it. The logo keeps its own display: forcing one on it breaks its centering.
export function OnboardingHeading({ title, subtitle, mark }: { title: ReactNode; subtitle?: ReactNode; mark?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-4 text-center">
            {mark ?? <Logo size="md" />}
            <div className="space-y-2">
                <DialogTitle className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">{title}</DialogTitle>
                {subtitle && <DialogDescription className="text-base text-balance">{subtitle}</DialogDescription>}
            </div>
        </div>
    )
}
