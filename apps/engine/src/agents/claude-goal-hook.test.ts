import { describe, expect, it, vi } from 'vitest'
import type { GoalVerdict, RunGoal } from '@moldwright/contracts'
import { goalStopHook } from './claude-goal-hook.js'

const goal = (turnLimit: number): RunGoal => ({ lastLineForms: [{ prefix: 'DONE ', rest: 'sha' }], turnLimit })
const stop = (last_assistant_message: string, stop_hook_active = false) => ({ hook_event_name: 'Stop', stop_hook_active, last_assistant_message })
const recorder = () => {
    const seen: GoalVerdict[] = []
    return { seen, record: async (v: GoalVerdict) => { seen.push(v) } }
}

describe('goalStopHook', () => {
    it('sends the run back twice at limit 3, then lets it end, recording turns 1 to 3', async () => {
        const { seen, record } = recorder()
        const hook = goalStopHook(goal(3), record)
        expect(hook.state()).toBe('running')
        expect(await hook(stop('nope'))).toMatchObject({ decision: 'block' })
        expect(await hook(stop('nope'))).toMatchObject({ decision: 'block' })
        expect(await hook(stop('nope'))).toEqual({ continue: true })
        expect(seen.map((v) => v.turn)).toEqual([1, 2, 3])
        expect(hook.state()).toBe('not_met')
    })

    it('ends on a match at turn 2', async () => {
        const { record } = recorder()
        const hook = goalStopHook(goal(3), record)
        expect(await hook(stop('nope'))).toMatchObject({ decision: 'block' })
        expect(await hook(stop('done\nDONE abc1234'))).toEqual({ continue: true })
        expect(hook.state()).toBe('met')
    })

    it('lets the first miss end at limit 1', async () => {
        const { record } = recorder()
        const hook = goalStopHook(goal(1), record)
        expect(await hook(stop('nope'))).toEqual({ continue: true })
        expect(hook.state()).toBe('not_met')
    })

    it('ignores stop_hook_active', async () => {
        const { record } = recorder()
        const hook = goalStopHook(goal(3), record)
        expect(await hook(stop('nope', true))).toMatchObject({ decision: 'block' })
    })

    it('answers the same when record throws', async () => {
        const hook = goalStopHook(goal(2), vi.fn().mockRejectedValue(new Error('db')))
        expect(await hook(stop('nope'))).toMatchObject({ decision: 'block' })
        expect(await hook(stop('nope'))).toEqual({ continue: true })
    })
})
