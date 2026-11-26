import { describe, expect, it } from 'vitest'

import type { EngineRun } from '@/lib/engine/types'

import { latestOutcomes } from './outcomes'

const run = (over: Partial<EngineRun>): EngineRun =>
    ({
        id: 'r1',
        agentId: 'a1',
        sessionId: 's1',
        status: 'done',
        triggerSource: 'schedule',
        triggerSlug: 'digest',
        startedAt: '2026-10-20T08:00:00Z',
        finishedAt: '2026-10-20T08:01:00Z',
        error: null,
        ...over,
    }) as EngineRun

describe('latestOutcomes', () => {
    it('keeps the newest ended run of each task, schedules and triggers apart', () => {
        const outcomes = latestOutcomes([
            run({ id: 'old', finishedAt: '2026-10-19T08:01:00Z', status: 'error' }),
            run({ id: 'new' }),
            run({ id: 'hook', triggerSource: 'trigger', status: 'error' }),
        ])
        expect(outcomes['schedule:digest']).toMatchObject({ runId: 'new', status: 'done' })
        expect(outcomes['trigger:digest']).toMatchObject({ runId: 'hook', status: 'error' })
    })

    it('skips a run still going, a stopped one, and a chat', () => {
        const outcomes = latestOutcomes([
            run({ id: 'ok', finishedAt: '2026-10-20T07:00:00Z' }),
            run({ id: 'running', status: 'running', finishedAt: null }),
            run({ id: 'stopped', status: 'cancelled' }),
            run({ id: 'chat', triggerSource: null, triggerSlug: null }),
        ])
        expect(Object.keys(outcomes)).toEqual(['schedule:digest'])
        expect(outcomes['schedule:digest'].runId).toBe('ok')
    })

    it("reads a promise of the Chief of Staff, which runs as a check-in, as its routine's run", () => {
        const outcomes = latestOutcomes([run({ id: 'c1', triggerSource: 'checkin', triggerSlug: 'back-on-invoices', status: 'done' })])
        expect(outcomes['schedule:back-on-invoices']).toMatchObject({ runId: 'c1', status: 'done' })
    })

    it('keeps the exit code and the start of a script run', () => {
        const outcomes = latestOutcomes([run({ id: 's1', sessionId: '', status: 'error', exitCode: 1 })])
        expect(outcomes['schedule:digest']).toEqual({ runId: 's1', sessionId: '', status: 'error', startedAt: '2026-10-20T08:00:00Z', finishedAt: '2026-10-20T08:01:00Z', exitCode: 1 })
    })
})
