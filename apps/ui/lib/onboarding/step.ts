import type { ForemanAnswers } from '@/lib/foreman/phase'

// The welcome page asks four questions, then starts the trial and the machine. Nothing records
// which step someone stands on: it is read off what the workspace already holds, so a reload, a
// second tab or a return the next day lands where they really are.

export const ONBOARDING_STEPS = ['site', 'industry', 'role', 'team', 'trial', 'engine'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export type OnboardingStepInput = {
    answers: ForemanAnswers
    entitled: boolean
    // Off on a self-hosted install, where nothing is sold and every workspace is entitled.
    billing: boolean
}

export function onboardingStep({ answers, entitled, billing }: OnboardingStepInput): OnboardingStep {
    const progress = answers.onboarding ?? {}
    if (!answers.company_url && !progress.siteSkipped) return 'site'
    if (!answers.industry) return 'industry'
    if (!answers.position?.trim()) return 'role'
    if (!progress.teamDone) return 'team'
    if (billing && !entitled) return 'trial'
    return 'engine'
}

export type NeedsOnboardingInput = {
    role: 'admin' | 'member' | null
    onboardedAt: string | null
    isSandbox: boolean
    archived: boolean
    agentCount: number
    // Paying for a plan rather than trying it: a running workspace is never walked through a sign-up.
    paying: boolean
    // Answered the welcome card of the onboarding chat before this page existed: it finishes there.
    inHubFunnel: boolean
    // Came through a workspace invitation, a creator invite or an AppSumo code: they join something.
    arrivingByInvite: boolean
    // A self-hosted install without a model key on the hub has no onboarding at all.
    hubForeman: boolean
}

export function needsOnboarding(input: NeedsOnboardingInput): boolean {
    if (!input.hubForeman || input.role !== 'admin') return false
    if (input.onboardedAt || input.isSandbox || input.archived) return false
    if (input.agentCount > 0 || input.paying || input.inHubFunnel) return false
    return !input.arrivingByInvite
}
