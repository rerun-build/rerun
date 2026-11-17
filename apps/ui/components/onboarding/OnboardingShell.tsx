'use client'

import { AuthTerms } from '@/components/auth/AuthShell'
import { OnboardingBoard } from '@/components/onboarding/OnboardingBoard'
import type { BoardTeams } from '@/lib/onboarding/board-teams'
import { useOnboardingSceneStore } from '@/stores/onboarding-scene.store'
import { Logo } from '@rerun/ui/logo'
import type { ReactNode } from 'react'

// The frame of the sign-in and of the questions after it: the form on the left, the board their
// answers staff on the right. On a phone or a narrow window the board becomes a band on top and the
// form scrolls under it.
export function OnboardingShell({ teams, children }: { teams: BoardTeams; children: ReactNode }) {
    const scene = useOnboardingSceneStore(state => state.scene)

    return (
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground selection:bg-primary/20 lg:flex-row">
            <div className="h-[32dvh] max-h-80 min-h-44 shrink-0 border-b bg-muted/20 lg:order-2 lg:h-auto lg:max-h-none lg:min-h-0 lg:flex-1 lg:border-b-0 lg:bg-transparent lg:p-3">
                <OnboardingBoard teams={teams} scene={scene} maxZoom={2.2} className="size-full bg-muted/20 lg:rounded-xl lg:border" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 lg:order-1 lg:w-[42%] lg:max-w-[38rem] lg:flex-none lg:px-12 lg:pt-8">
                <Logo size="sm" className="hidden lg:block" />
                <main className="mx-auto w-full max-w-sm py-6 lg:mx-0 lg:my-auto lg:py-10">{children}</main>
                <p className="mt-auto shrink-0 pb-[calc(var(--consent-inset)+max(1.5rem,env(safe-area-inset-bottom)))] text-center text-xs text-muted-foreground lg:text-left">
                    <AuthTerms />
                </p>
            </div>
        </div>
    )
}

export function OnboardingHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
    return (
        <div className="space-y-2">
            <h1 className="text-3xl font-medium tracking-tight text-balance">{title}</h1>
            {subtitle && <p className="text-base text-balance text-muted-foreground">{subtitle}</p>}
        </div>
    )
}
