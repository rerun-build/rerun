import { foremanIndustryResultSchema, foremanTrialResultSchema, onboardingEngineSchema, onboardingStateSchema, type ForemanIntakeRequest, type OnboardingState, type TemplateCategory } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const BASE = '/api/v1/onboarding'

export async function fetchOnboardingState(caller: Caller): Promise<OnboardingState> {
    return onboardingStateSchema.parse(await api(BASE, caller))
}

export async function saveIntake(caller: Caller, intake: ForemanIntakeRequest): Promise<void> {
    await api(`${BASE}/intake`, { ...caller, method: 'POST', body: intake })
}

export async function decideIndustry(caller: Caller, input: string): Promise<TemplateCategory | null> {
    return foremanIndustryResultSchema.parse(await api(`${BASE}/industry`, { ...caller, method: 'POST', body: { input } })).industry
}

// Whether the workspace is on once the app has asked: false for a trial already spent.
export async function startWorkspace(caller: Caller): Promise<boolean> {
    return foremanTrialResultSchema.parse(await api(`${BASE}/trial`, { ...caller, method: 'POST' })).entitled
}

export async function claimEngine(caller: Caller): Promise<void> {
    await api(`${BASE}/engine`, { ...caller, method: 'POST' })
}

export async function engineAnswers(caller: Caller): Promise<boolean> {
    return onboardingEngineSchema.parse(await api(`${BASE}/engine`, caller)).ready
}

export async function finishOnboarding(caller: Caller): Promise<void> {
    await api(`${BASE}/finish`, { ...caller, method: 'POST' })
}
