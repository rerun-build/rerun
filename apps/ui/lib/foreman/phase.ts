import { FOREMAN_PHASES, isMobileClient, type ForemanClient, type ForemanPhase, type TemplatePricing } from '@moldwright/contracts'

import type { OnboardingAnswers } from '@/app/actions/onboarding'
import type { PriceArm } from '@moldwright/cloud/billing'
import { RERUN_CLOUD } from '@moldwright/cloud/edition'
import type { ForemanAgentRow, ForemanSpaceRow } from './board-map'
import type { KickoffIntent } from './kickoff-marker'

export { FOREMAN_PHASES, type ForemanPhase }

export type ForemanPlanItem =
    | { kind: 'template'; slug: string; title?: string; focus?: string; box?: string }
    | { kind: 'agent'; name: string; role: string; need?: string; asked?: string; gets?: string[]; delivered?: string; box?: string }
    | { kind: 'share'; token: string; name?: string; box?: string }

export type ForemanPlanBox = { name: string; role?: string }

export type ForemanPlan = { title: string; items: ForemanPlanItem[]; boxes?: ForemanPlanBox[] }

export type ForemanNeed = { job: string; pain: string; today?: string }

export type ForemanProfile = {
    profileAt?: string
    useCases?: string[]
    pain?: string
    needs?: ForemanNeed[]
    pains?: string[]
    challenge?: string
    interviewAt?: string
    language?: string
    plan?: ForemanPlan
    planAt?: string
    firstRunAt?: string
    installedFirst?: boolean
    trialStartedIn?: ForemanClient
}

export function foremanUseCases(foreman: ForemanProfile): string[] {
    if (foreman.useCases?.length) return foreman.useCases
    return foreman.pain ? [foreman.pain] : []
}

export type ForemanAnswers = OnboardingAnswers & { foreman?: ForemanProfile }

export type PhaseInput = {
    foreman: ForemanProfile
    onboardingCompletedAt: string | null
    entitled: boolean
    trialing?: boolean
    agentCount: number
    waitlisted?: boolean
    arrivedReadyMade?: boolean
    hubForeman?: boolean
}

export function foremanPhase({ foreman, onboardingCompletedAt, entitled, trialing = false, agentCount, waitlisted = false, arrivedReadyMade = false, hubForeman = true }: PhaseInput): ForemanPhase {
    if (!hubForeman) return 'companion'

    const inFunnel = !!foreman.profileAt || !!foreman.plan

    if (!inFunnel && ((RERUN_CLOUD && entitled && !trialing) || agentCount > 0 || onboardingCompletedAt)) return 'companion'

    const owesProfile = !!foreman.installedFirst && !foreman.profileAt

    if (foreman.firstRunAt) return owesProfile ? 'discover' : 'companion'

    if (waitlisted) return 'waitlist'

    if (!inFunnel) return arrivedReadyMade ? 'plan' : 'discover'

    if (!foreman.plan) return 'plan'
    if (!entitled) return 'trial'
    if (agentCount === 0) return 'build'
    return owesProfile ? 'discover' : 'companion'
}

export type ArrivingIntent = KickoffIntent & { description?: string; title?: string; paid?: TemplatePricing; coworker?: string }

export function isMobileApp(state: Pick<ForemanState, 'client'>): boolean {
    return isMobileClient(state.client)
}

export function isReadyMade(intent: KickoffIntent | null): boolean {
    return intent?.kind === 'template' || intent?.kind === 'share'
}

export function isNamedReadyMade(intent: ArrivingIntent | null): boolean {
    return isReadyMade(intent) && !!intent?.title
}

export function installedArrival(foreman: ForemanProfile): ForemanArrival | null {
    if (!foreman.installedFirst) return null
    const [item] = foreman.plan?.items ?? []
    if (item?.kind === 'template' && item.title) return { kind: 'template', title: item.title }
    if (item?.kind === 'share' && item.name) return { kind: 'share', title: item.name }
    return null
}

export type ForemanArrival = { kind: 'template' | 'share'; title: string; installed?: boolean; paid?: TemplatePricing; coworker?: string }

export type ForemanBackend = 'hub' | 'engine'

export type ForemanState = {
    phase: ForemanPhase
    intent: ArrivingIntent | null
    answers: ForemanAnswers
    foreman: ForemanProfile
    onboardingCompletedAt: string | null
    firstName: string
    language: string | null
    entitled: boolean
    trialing?: boolean
    trialSpent: boolean
    trialNeedsCard: boolean
    priceArm: PriceArm
    client: ForemanClient
    workspaceName: string
    workspacePlan: string
    userEmail: string | null
    spaces: ForemanSpaceRow[]
    agents: ForemanAgentRow[]
    hiddenBoxes?: number
    isMember?: boolean
}
