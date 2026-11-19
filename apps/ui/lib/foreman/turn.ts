import { asRecord } from '@moldwright/contracts'
import { foremanPhase, isNamedReadyMade, type ForemanAnswers, type ForemanState } from './phase'

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
            const answers = asRecord(asRecord(result).profile) as ForemanAnswers
            if (!answers.foreman) return
            const next = { ...state, answers, foreman: answers.foreman, onboardingCompletedAt: state.onboardingCompletedAt ?? new Date().toISOString() }
            state = { ...next, phase: foremanPhase({ foreman: next.foreman, onboardingCompletedAt: next.onboardingCompletedAt, entitled: next.entitled, trialing: next.trialing, agentCount: next.agents.length, arrivedReadyMade: isNamedReadyMade(next.intent) }) }
        },
    }
}
