import type { OnboardingStep } from '@rerun/contracts'

import type { ForemanProfile } from '@/lib/foreman/phase'

// Everything the step is read from, gathered by facts.ts. Nothing here reads or writes: the step a
// workspace stands on is derived again on every read, so someone who closes the tab after paying,
// or answers on their phone, comes back where they really are.
export type OnboardingFacts = {
    admin: boolean
    sandbox: boolean
    createdAt: string | null
    archived: boolean
    onboardedAt: string | null
    foreman: ForemanProfile
    agentCount: number
    phonePending: boolean
    entitled: boolean
    hasEngine: boolean
    // Only asked of the pool when it can change the answer: not entitled, no box, Rerun Cloud.
    poolHasRoom: boolean
    cloud: boolean
}

// A workspace that went its way before the dialog existed: it keeps the hub's onboarding and its
// surface as they were. One that already had its say (survey done, no profile since) or one that
// never started (created before the release, nothing written) is not handed an unclosable dialog on
// its next visit.
export function isLegacyWorkspace(facts: Pick<OnboardingFacts, 'createdAt' | 'onboardedAt' | 'foreman'>, releasedAt: string | null): boolean {
    if (!releasedAt) return true
    const { profileAt, plan } = facts.foreman
    if (facts.onboardedAt && !profileAt) return true
    return !profileAt && !plan && (!facts.createdAt || facts.createdAt < releasedAt)
}

// A template or a shared coworker: it skips the questions and the invitation, and is installed once
// the box is there.
export function arrivedReadyMade(foreman: ForemanProfile): boolean {
    return foreman.arrival?.kind === 'template' || foreman.arrival?.kind === 'share' || !!foreman.installedFirst
}

export function onboardingStep(facts: OnboardingFacts, releasedAt: string | null): OnboardingStep {
    const { foreman } = facts
    // Guards first: a workspace that runs never sees the dialog.
    if (!facts.admin || facts.sandbox) return 'done'
    if (isLegacyWorkspace(facts, releasedAt)) return 'done'
    const readyMade = arrivedReadyMade(foreman)
    if (foreman.firstRunAt || facts.agentCount > 0) {
        // What a link installed is on the board, and the Chief of Staff has yet to say hello.
        return facts.hasEngine && foreman.arrival && foreman.arrival.kind !== 'prompt' && !foreman.handoffAt ? 'handoff' : 'done'
    }
    if (facts.archived) return 'restoring'

    if (!foreman.profileAt && !readyMade) return 'profile'
    if (facts.cloud && facts.phonePending) return 'phone'
    // A plan accepted and paid for in the hub's onboarding is a team on its way: it goes on to its box.
    const paidPlan = !!foreman.plan && facts.entitled
    if (!foreman.inviteAt && !readyMade && !paidPlan) return 'invite'

    if (facts.cloud && !facts.entitled) return !facts.hasEngine && !facts.poolHasRoom ? 'waitlist' : 'trial'
    if (!facts.hasEngine) return 'claiming'
    if (readyMade) return 'installing'
    return 'handoff'
}
