import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-runs-'))
process.env.RERUN_API_KEY = ''

const { afterEach, describe, expect, it, vi } = await import('vitest')
const { aggregateUsageByDay, bumpRunStep, cancelRun, failInterruptedRuns, failRun, finishRun, getRun, listRunsByAgent, recordGoalVerdict, recordRunCompaction, setRunCompactAt, setRunContext, setRunGoal, setRunLineage, startRun, updateRunLive } = await import('./runs.js')

afterEach(() => {
    vi.useRealTimers()
})

function at(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}

describe('run lifecycle', () => {
    it('starts a running row with no usage', async () => {
        const run = await startRun('life', 's1', 'r-start')
        expect(run).toMatchObject({ id: 'r-start', agentId: 'life', sessionId: 's1', status: 'running', stepCount: 0, usageJson: null, finishedAt: null })
        expect(await getRun('life', 'r-start')).toEqual(run)
    })

    it('generates an id when none is given', async () => {
        const run = await startRun('life', 's1')
        expect(run.id).toMatch(/^[0-9a-z]{21}$/)
    })

    it('finishes with the usage columns, the cost and the step count', async () => {
        await startRun('life', 's1', 'r-done')
        await setRunContext('life', 'r-done', { provider: 'anthropic', model: 'claude', triggerSource: 'schedule', triggerSlug: 'daily' })
        await bumpRunStep('life', 'r-done', 2)
        const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 4, cachedInputTokens: 5 }

        await finishRun('life', 'r-done', usage, 3, 1234)

        const run = await getRun('life', 'r-done')
        expect(run).toMatchObject({
            status: 'done',
            stepCount: 3,
            costMicros: 1234,
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            reasoningTokens: 4,
            cachedInputTokens: 5,
            provider: 'anthropic',
            model: 'claude',
            triggerSource: 'schedule',
            triggerSlug: 'daily',
            error: null,
        })
        expect(run?.finishedAt).not.toBeNull()
        expect(JSON.parse(run!.usageJson!)).toEqual(usage)
    })

    it('writes live progress while running and never after the run settled', async () => {
        await startRun('life', 's1', 'r-live')
        await updateRunLive('life', 'r-live', { stepCount: 4, usage: { inputTokens: 9 } })
        expect(await getRun('life', 'r-live')).toMatchObject({ status: 'running', stepCount: 4, inputTokens: 9, outputTokens: null })

        await finishRun('life', 'r-live', { inputTokens: 10, outputTokens: 20 }, 5)
        await updateRunLive('life', 'r-live', { stepCount: 99, usage: { inputTokens: 99 } })
        expect(await getRun('life', 'r-live')).toMatchObject({ status: 'done', stepCount: 5, inputTokens: 10, outputTokens: 20 })

        await startRun('life', 's1', 'r-live-failed')
        await failRun('life', 'r-live-failed', 'boom')
        await updateRunLive('life', 'r-live-failed', { stepCount: 7 })
        expect(await getRun('life', 'r-live-failed')).toMatchObject({ status: 'error', stepCount: 0 })
    })

    it('folds the context occupancy into the usage json', async () => {
        await startRun('life', 's1', 'r-ctx')
        const context = { usedTokens: 5000, windowTokens: 200000 }
        await finishRun('life', 'r-ctx', { totalTokens: 7 }, 1, null, context as never)

        const run = await getRun('life', 'r-ctx')
        expect(JSON.parse(run!.usageJson!)).toEqual({ totalTokens: 7, context })
        expect(run).toMatchObject({ totalTokens: 7, inputTokens: null, costMicros: null })
    })

    it('stores a null usage as json null', async () => {
        await startRun('life', 's1', 'r-null')
        await finishRun('life', 'r-null', null, 0)
        const run = await getRun('life', 'r-null')
        expect(run?.usageJson).toBe('null')
        expect(run?.totalTokens).toBeNull()
    })

    it('fails and cancels', async () => {
        await startRun('life', 's1', 'r-fail')
        await startRun('life', 's1', 'r-cancel')

        await failRun('life', 'r-fail', 'boom')
        await cancelRun('life', 'r-cancel')

        expect(await getRun('life', 'r-fail')).toMatchObject({ status: 'error', error: 'boom' })
        expect((await getRun('life', 'r-fail'))?.finishedAt).not.toBeNull()
        expect(await getRun('life', 'r-cancel')).toMatchObject({ status: 'cancelled', error: null })
        expect((await getRun('life', 'r-cancel'))?.finishedAt).not.toBeNull()
    })

    it('returns undefined for an unknown run', async () => {
        expect(await getRun('life', 'ghost')).toBeUndefined()
    })
})

describe('failInterruptedRuns', () => {
    it('marks every running row as interrupted and returns them', async () => {
        at('2026-09-01T10:00:00.000Z')
        await startRun('crash', 's1', 'stale-1')
        await setRunContext('crash', 'stale-1', { provider: 'p', model: 'm', triggerSource: 'trigger', triggerSlug: 'hook' })
        await startRun('crash', 's2', 'stale-2')
        await startRun('crash', 's3', 'finished')
        await finishRun('crash', 'finished', null, 1)

        const repaired = await failInterruptedRuns('crash')

        expect(repaired.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
            { id: 'stale-1', sessionId: 's1', triggerSource: 'trigger', triggerSlug: 'hook', startedAt: '2026-09-01T10:00:00.000Z' },
            { id: 'stale-2', sessionId: 's2', triggerSource: null, triggerSlug: null, startedAt: '2026-09-01T10:00:00.000Z' },
        ])
        expect(await getRun('crash', 'stale-1')).toMatchObject({ status: 'error', error: 'interrupted: engine restarted' })
        expect(await getRun('crash', 'finished')).toMatchObject({ status: 'done', error: null })
    })

    it('returns an empty list when nothing is running', async () => {
        expect(await failInterruptedRuns('crash')).toEqual([])
    })
})

describe('listRunsByAgent', () => {
    it('lists newest first and honours the limit', async () => {
        for (const [id, iso] of [['a', '2026-09-01T00:00:00.000Z'], ['c', '2026-09-03T00:00:00.000Z'], ['b', '2026-09-02T00:00:00.000Z']]) {
            at(iso)
            await startRun('list', 's', id)
        }

        expect((await listRunsByAgent('list')).map(run => run.id)).toEqual(['c', 'b', 'a'])
        expect((await listRunsByAgent('list', { limit: 2 })).map(run => run.id)).toEqual(['c', 'b'])
    })

    it('narrows to one session and one status', async () => {
        at('2026-09-01T00:00:00.000Z')
        await startRun('filtered', 'mine', 'old-done')
        await finishRun('filtered', 'old-done', null, 1)
        at('2026-09-02T00:00:00.000Z')
        await startRun('filtered', 'other', 'other-running')
        at('2026-09-03T00:00:00.000Z')
        await startRun('filtered', 'mine', 'new-running')

        expect((await listRunsByAgent('filtered', { sessionId: 'mine' })).map(run => run.id)).toEqual(['new-running', 'old-done'])
        expect((await listRunsByAgent('filtered', { status: 'running' })).map(run => run.id)).toEqual(['new-running', 'other-running'])
        expect((await listRunsByAgent('filtered', { sessionId: 'mine', status: 'done' })).map(run => run.id)).toEqual(['old-done'])
    })
})

describe('aggregateUsageByDay', () => {
    async function done(id: string, iso: string, model: string | null, usage: { inputTokens: number; outputTokens: number; totalTokens: number }, cost: number | null) {
        at(iso)
        await startRun('usage', 's', id)
        if (model) await setRunContext('usage', id, { provider: 'p', model, triggerSource: 'chat', triggerSlug: null })
        await finishRun('usage', id, usage, 1, cost)
    }

    it('sums done runs by day and model, oldest day first', async () => {
        await done('d1-a', '2026-09-01T08:00:00.000Z', 'opus', { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, 100)
        await done('d1-b', '2026-09-01T20:00:00.000Z', 'opus', { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, null)
        await done('d1-c', '2026-09-01T21:00:00.000Z', 'haiku', { inputTokens: 5, outputTokens: 5, totalTokens: 10 }, 7)
        await done('d2-a', '2026-09-02T09:00:00.000Z', 'opus', { inputTokens: 2, outputTokens: 2, totalTokens: 4 }, 1)
        at('2026-09-01T09:00:00.000Z')
        await startRun('usage', 's', 'failed')
        await setRunContext('usage', 'failed', { provider: 'p', model: 'opus', triggerSource: 'chat', triggerSlug: null })
        await failRun('usage', 'failed', 'x')
        await startRun('usage', 's', 'running')

        const buckets = await aggregateUsageByDay('usage', null)

        const key = (b: { day: string; model: string | null }) => `${b.day}|${b.model}`
        expect(buckets.map(b => b.day)).toEqual(['2026-09-01', '2026-09-01', '2026-09-02'])
        const byKey = Object.fromEntries(buckets.map(b => [key(b), b]))
        expect(byKey['2026-09-01|opus']).toEqual({
            day: '2026-09-01',
            model: 'opus',
            inputTokens: 11,
            outputTokens: 22,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 33,
            costMicros: 100,
            runCount: 2,
        })
        expect(byKey['2026-09-01|haiku']).toMatchObject({ totalTokens: 10, costMicros: 7, runCount: 1 })
        expect(byKey['2026-09-02|opus']).toMatchObject({ totalTokens: 4, runCount: 1 })
    })

    it('drops runs started before sinceIso', async () => {
        const buckets = await aggregateUsageByDay('usage', '2026-09-01T20:00:00.000Z')
        const counts = buckets.map(b => `${b.day}|${b.model}|${b.runCount}`)
        expect(counts.sort()).toEqual(['2026-09-01|haiku|1', '2026-09-01|opus|1', '2026-09-02|opus|1'])
    })

    it('is empty for an agent without runs', async () => {
        expect(await aggregateUsageByDay('nobody', null)).toEqual([])
    })
})

describe('run lineage', () => {
    it('round-trips the lineage fields and leaves them null at start', async () => {
        const run = await startRun('lin', 's1', 'r-lin')
        expect(run).toMatchObject({ initiatorAgentId: null, initiatorRunId: null, initiatorSessionId: null, initiatorUserId: null, jobRef: null, branch: null, copyIndex: null })
        const patch = { initiatorAgentId: 'boss', initiatorRunId: 'r0', initiatorSessionId: 's0', initiatorUserId: 'u1', jobRef: 'rerun#128', branch: 'job/128', copyIndex: 2 }
        await setRunLineage('lin', 'r-lin', patch)
        expect(await getRun('lin', 'r-lin')).toMatchObject(patch)
    })

    it('filters by job and by branch', async () => {
        await startRun('lin2', 's1', 'a')
        await startRun('lin2', 's1', 'b')
        await startRun('lin2', 's1', 'c')
        await setRunLineage('lin2', 'a', { jobRef: 'rerun#1', branch: 'job/1' })
        await setRunLineage('lin2', 'b', { jobRef: 'rerun#1', branch: 'job/other' })
        await setRunLineage('lin2', 'c', { jobRef: 'rerun#2', branch: 'job/1' })
        expect((await listRunsByAgent('lin2', { job: 'rerun#1' })).map(r => r.id).sort()).toEqual(['a', 'b'])
        expect((await listRunsByAgent('lin2', { branch: 'job/1' })).map(r => r.id).sort()).toEqual(['a', 'c'])
        expect((await listRunsByAgent('lin2', { job: 'rerun#1', branch: 'job/1' })).map(r => r.id)).toEqual(['a'])
    })
})

describe('run goal', () => {
    const goal = JSON.stringify({ text: 'ship it' })

    it('sets the goal once, only while none is set', async () => {
        await startRun('goal', 's1', 'g1')
        expect(await getRun('goal', 'g1')).toMatchObject({ goalJson: null, goalState: null, goalTurns: null, goalVerdictsJson: null })
        await setRunGoal('goal', 'g1', goal)
        expect(await getRun('goal', 'g1')).toMatchObject({ goalJson: goal, goalState: 'running', goalTurns: 0, goalVerdictsJson: '[]' })
        await setRunGoal('goal', 'g1', JSON.stringify({ text: 'other' }))
        expect((await getRun('goal', 'g1'))?.goalJson).toBe(goal)
    })

    it('appends a verdict and counts the turn in one write, only while running', async () => {
        await startRun('goal', 's1', 'g2')
        await recordGoalVerdict('goal', 'g2', { turn: 1, met: true, reason: 'ignored' })
        expect((await getRun('goal', 'g2'))?.goalVerdictsJson).toBeNull()
        await setRunGoal('goal', 'g2', goal)
        await recordGoalVerdict('goal', 'g2', { turn: 1, met: false, reason: 'no' })
        await recordGoalVerdict('goal', 'g2', { turn: 2, met: true, reason: 'yes' })
        const run = await getRun('goal', 'g2')
        expect(run?.goalTurns).toBe(2)
        expect(JSON.parse(run?.goalVerdictsJson ?? '')).toEqual([{ turn: 1, met: false, reason: 'no' }, { turn: 2, met: true, reason: 'yes' }])
    })

    it('finishRun sets the goal state with the status', async () => {
        await startRun('goal', 's1', 'g3')
        await setRunGoal('goal', 'g3', goal)
        await finishRun('goal', 'g3', null, 1, null, undefined, 'not_met')
        expect(await getRun('goal', 'g3')).toMatchObject({ status: 'done', goalState: 'not_met' })
        await startRun('goal', 's1', 'g3b')
        await finishRun('goal', 'g3b', null, 1)
        expect((await getRun('goal', 'g3b'))?.goalState).toBeNull()
    })

    it('fail, cancel and interrupted turn a running goal into unchecked and leave the rest', async () => {
        for (const id of ['g4', 'g5', 'g6', 'g7']) await startRun('goalend', 's1', id)
        for (const id of ['g4', 'g5', 'g6']) await setRunGoal('goalend', id, goal)
        await failRun('goalend', 'g4', 'boom')
        await cancelRun('goalend', 'g5')
        await failInterruptedRuns('goalend')
        expect((await getRun('goalend', 'g4'))?.goalState).toBe('unchecked')
        expect((await getRun('goalend', 'g5'))?.goalState).toBe('unchecked')
        expect((await getRun('goalend', 'g6'))?.goalState).toBe('unchecked')
        expect((await getRun('goalend', 'g7'))?.goalState).toBeNull()
    })

    it('does not touch a goal state already settled', async () => {
        await startRun('goalend2', 's1', 'g8')
        await setRunGoal('goalend2', 'g8', goal)
        await finishRun('goalend2', 'g8', null, 1, null, undefined, 'met')
        await failRun('goalend2', 'g8', 'late')
        expect((await getRun('goalend2', 'g8'))?.goalState).toBe('met')
    })
})

describe('run compactions', () => {
    it('starts with none, then counts each compaction and sums the summary sizes', async () => {
        await startRun('comp', 's1', 'r-comp')
        expect(await getRun('comp', 'r-comp')).toMatchObject({ compactions: null, compactSummaryChars: null, compactAtTokens: null })

        await setRunCompactAt('comp', 'r-comp', 240000)
        await recordRunCompaction('comp', 'r-comp', 900)
        await recordRunCompaction('comp', 'r-comp', 0)
        await Promise.all([recordRunCompaction('comp', 'r-comp', 100), recordRunCompaction('comp', 'r-comp', 5)])

        expect(await getRun('comp', 'r-comp')).toMatchObject({ compactions: 4, compactSummaryChars: 1005, compactAtTokens: 240000 })
    })
})
