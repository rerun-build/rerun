import { mobileApi, type ForemanIntakeRequest, type OnboardingState, type TemplateCategory } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchOnboardingState(caller: Caller): Promise<OnboardingState> {
    return hub(mobileApi.getOnboarding, caller)
}

export async function saveIntake(caller: Caller, intake: ForemanIntakeRequest): Promise<void> {
    await hub(mobileApi.saveOnboardingIntake, { ...caller, body: intake })
}

export async function decideIndustry(caller: Caller, input: string): Promise<TemplateCategory | null> {
    return (await hub(mobileApi.decideOnboardingIndustry, { ...caller, body: { input } })).industry
}

// Whether the workspace is on once the app has asked: false for a trial already spent.
export async function startWorkspace(caller: Caller): Promise<boolean> {
    return (await hub(mobileApi.startOnboardingTrial, caller)).entitled
}

export async function claimEngine(caller: Caller): Promise<void> {
    await hub(mobileApi.claimOnboardingEngine, caller)
}

export async function engineAnswers(caller: Caller): Promise<boolean> {
    return (await hub(mobileApi.getOnboardingEngine, caller)).ready
}

export async function finishOnboarding(caller: Caller): Promise<void> {
    await hub(mobileApi.finishOnboarding, caller)
}
