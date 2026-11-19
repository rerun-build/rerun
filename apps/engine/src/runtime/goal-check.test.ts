import { describe, expect, it } from 'vitest'
import { chatRequestSchema, runGoalSchema, type RunGoal } from '@moldwright/contracts'
import { checkGoal, goalFeedback } from './goal-check.js'

const goal: RunGoal = {
    lastLineForms: [
        { prefix: 'PR: ', rest: 'pull-url' },
        { prefix: 'BLOCKED: ', rest: 'sentence' },
        { prefix: 'PUSHED: ', rest: 'sha' },
        { prefix: 'VERDICT: REJECT @', rest: 'sentence' },
    ],
    turnLimit: 3,
}
const accept: RunGoal = { lastLineForms: [{ prefix: 'VERDICT: ACCEPT @', rest: 'sha' }], turnLimit: 2 }

describe('goal schema', () => {
    it('parses a valid goal', () => {
        expect(runGoalSchema.safeParse(goal).success).toBe(true)
    })
    it('refuses a bad turnLimit', () => {
        for (const turnLimit of [0, 11, undefined]) {
            expect(runGoalSchema.safeParse({ ...goal, turnLimit }).success).toBe(false)
        }
    })
    it('refuses 0 or 5 forms', () => {
        const f = { prefix: 'A: ', rest: 'sha' }
        expect(runGoalSchema.safeParse({ ...goal, lastLineForms: [] }).success).toBe(false)
        expect(runGoalSchema.safeParse({ ...goal, lastLineForms: [f, f, f, f, f] }).success).toBe(false)
    })
    it('refuses an unknown key and an unknown rest kind', () => {
        expect(runGoalSchema.safeParse({ ...goal, lastLinePattern: '.*' }).success).toBe(false)
        expect(
            runGoalSchema.safeParse({ ...goal, lastLineForms: [{ prefix: 'A: ', rest: 'regex' }] }).success,
        ).toBe(false)
    })
    it('chat request without a goal still parses', () => {
        expect(chatRequestSchema.safeParse({ message: 'hi' }).success).toBe(true)
        expect(chatRequestSchema.safeParse({ message: 'hi', goal }).success).toBe(true)
    })
})

describe('checkGoal', () => {
    const met = (a: string, g: RunGoal = goal) => checkGoal(g, a, 1).met
    it('table', () => {
        expect(met('work\nPR: https://github.com/o/r/pull/12')).toBe(true)
        expect(met('PR: https://github.com/o/r/pull/0')).toBe(false)
        expect(met('BLOCKED: x')).toBe(true)
        expect(met('BLOCKED: ')).toBe(false)
        expect(met('PUSHED: abc1234')).toBe(true)
        expect(met('PUSHED: abc12')).toBe(false)
        expect(met(`VERDICT: REJECT @abc1234: ${'x'.repeat(600)}`)).toBe(true)
        expect(met('VERDICT: ACCEPT @abc1234', accept)).toBe(true)
        expect(met('PR: https://github.com/o/r/pull/12\n\n  \n')).toBe(true)
        expect(met('')).toBe(false)
        expect(met('  \n\n')).toBe(false)
    })
    it('a tools line after the form line is not met and is quoted', () => {
        const v = checkGoal(goal, 'PR: https://github.com/o/r/pull/12\nTools: shell 3 calls', 2)
        expect(v.met).toBe(false)
        expect(v.reason).toContain('Tools: shell 3 calls')
        expect(v.turn).toBe(2)
    })
    it('a 2001-character last line is not met, 2000 is', () => {
        expect(met(`BLOCKED: ${'x'.repeat(2001 - 9)}`)).toBe(false)
        expect(met(`BLOCKED: ${'x'.repeat(2000 - 9)}`)).toBe(true)
    })
    it('a form line before the last 8000 characters is not seen', () => {
        expect(met(`BLOCKED: x\n${'y'.repeat(8000)}`)).toBe(false)
    })
    it('reason is at most 300 characters and the quote is cut at 120', () => {
        const v = checkGoal(goal, 'z'.repeat(1500), 1)
        expect(v.reason.length).toBeLessThanOrEqual(300)
        expect(v.reason).not.toContain('z'.repeat(121))
    })
    it('does not turn the prefix into a pattern', () => {
        const g: RunGoal = { lastLineForms: [{ prefix: '.*', rest: 'sentence' }], turnLimit: 1 }
        expect(met('anything here', g)).toBe(false)
        expect(met('.*x', g)).toBe(true)
    })
})

describe('goalFeedback', () => {
    it('names the forms, quotes the line, tells to write only the last line', () => {
        const t = goalFeedback(goal, checkGoal(goal, 'done\nnope', 1))
        expect(t).toContain('PR: <pull request url>')
        expect(t).toContain('BLOCKED: <one sentence>')
        expect(t).toContain('PUSHED: <commit>')
        expect(t).toContain('Your answer ended with: nope')
        expect(t).toContain('do not redo the work')
    })
    it('says the limit when the last line is too long', () => {
        const t = goalFeedback(goal, checkGoal(goal, 'x'.repeat(2001), 1))
        expect(t).toContain('2000')
    })
})
