import type { ForemanPhase } from '../phase'
import { BUILD_PHASE } from './build'
import { DISCOVER_PHASE } from './discover'
import { PLAN_PHASE } from './plan'
import type { ActiveForemanPhase, PhaseSpec } from './spec'
import { TRIAL_PHASE } from '@rerun/cloud/foreman'

export type { ActiveForemanPhase, PhaseSpec } from './spec'
export { phaseTools } from './spec'
export { forcesFirstPlan, pinnedPlanBoxes, planKinds } from './plan'

export const PHASES: Record<ActiveForemanPhase, PhaseSpec> = {
    discover: DISCOVER_PHASE,
    plan: PLAN_PHASE,
    trial: TRIAL_PHASE,
    build: BUILD_PHASE,
}

export function isOnboardingPhase(phase: ForemanPhase): phase is ActiveForemanPhase {
    return phase !== 'waitlist' && phase !== 'companion'
}

export function phaseSpec(phase: ForemanPhase): PhaseSpec {
    if (phase === 'waitlist') throw new Error('The foreman has no turn to take while the workspace waits for a machine')
    if (phase === 'companion') throw new Error('The onboarding is over: the foreman of this workspace runs on its engine')
    return PHASES[phase]
}
