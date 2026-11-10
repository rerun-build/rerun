import { asRecord } from '@rerun/contracts'
import { foremanPhase, isNamedReadyMade, type ForemanAnswers, type ForemanState } from './phase'

// Where the workspace stands, kept up to date for the length of one POST.
//
// The phase is derived from workspace facts, and some of those facts are written by tools that run in
// the middle of a turn: save_profile opens the plan. Resolved once
// per request, the model would finish its turn holding the belt of the step it has just left, and
// nothing relaunches it: a server tool is already resolved, so the browser's automatic resume never
// fires.
//
// So the turn keeps its own copy of the inputs of foremanPhase, updates them from what the tools
// returned, and the route hands the phase back to the model between two steps. The confirmed plan,
// the trial and the build are not in here: the app runs those itself, between two requests
// (scripted.ts).

export type ForemanTurn = {
    state: () => ForemanState
    note: (toolName: string, result: unknown) => void
}

export function createForemanTurn(initial: ForemanState): ForemanTurn {
    let state = initial

    return {
        state: () => state,
        note: (toolName, result) => {
            if (toolName !== 'save_profile') return
            // The whole profile comes back rather than the patch, and with it the stamp that
            // save_profile writes on the user row on its way through.
            const answers = asRecord(asRecord(result).profile) as ForemanAnswers
            if (!answers.foreman) return
            const next = { ...state, answers, foreman: answers.foreman, onboardingCompletedAt: state.onboardingCompletedAt ?? new Date().toISOString() }
            state = { ...next, phase: foremanPhase({ foreman: next.foreman, onboardingCompletedAt: next.onboardingCompletedAt, entitled: next.entitled, trialing: next.trialing, agentCount: next.agents.length, arrivedReadyMade: isNamedReadyMade(next.intent) }) }
        },
    }
}
