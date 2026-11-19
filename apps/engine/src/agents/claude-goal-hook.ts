import type { GoalVerdict, RunGoal } from '@moldwright/contracts'
import { checkGoal, goalFeedback } from '../runtime/goal-check.js'

type StopInput = { hook_event_name?: string; last_assistant_message?: string }
type StopAnswer = { continue: true } | { decision: 'block'; reason: string }
export type GoalStopHook = ((...args: unknown[]) => Promise<StopAnswer>) & { state: () => 'running' | 'met' | 'not_met' }

export function goalStopHook(goal: RunGoal, record: (v: GoalVerdict) => Promise<void>): GoalStopHook {
    let counter = 0
    let last: GoalVerdict | undefined
    const hook = async (...args: unknown[]): Promise<StopAnswer> => {
        const input = (args[0] ?? {}) as StopInput
        if (input.hook_event_name !== 'Stop') return { continue: true }
        const turn = ++counter
        const verdict = checkGoal(goal, input.last_assistant_message ?? '', turn)
        last = verdict
        try {
            await record(verdict)
        } catch (err) {
            console.error('goal verdict not recorded', err)
        }
        if (verdict.met || turn >= goal.turnLimit) return { continue: true }
        return { decision: 'block', reason: goalFeedback(goal, verdict) }
    }
    return Object.assign(hook, { state: (): 'running' | 'met' | 'not_met' => (!last ? 'running' : last.met ? 'met' : last.turn >= goal.turnLimit ? 'not_met' : 'running') })
}
