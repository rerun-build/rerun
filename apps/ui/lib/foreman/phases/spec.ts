import type { ForemanToolName } from '../tool-defs'
import type { ForemanPhase, ForemanState } from '../phase'

export type ActiveForemanPhase = Exclude<ForemanPhase, 'waitlist' | 'companion'>

export type PhaseSpec = {
    phase: ActiveForemanPhase
    instructions: (state: ForemanState) => string
    tools: readonly ForemanToolName[] | ((state: ForemanState) => readonly ForemanToolName[])
}

export function phaseTools(spec: PhaseSpec, state: ForemanState): readonly ForemanToolName[] {
    return typeof spec.tools === 'function' ? spec.tools(state) : spec.tools
}
