import { describe, expect, it } from 'vitest'
import { projectRun } from './run-projection'

const base = { id: 'r1', status: 'done', sessionId: 's1', provider: null, model: null, triggerSource: 'api', triggerSlug: null, stepCount: 1, inputTokens: null, outputTokens: null, totalTokens: null, costMicros: null, startedAt: '2026-11-13T00:00:00.000Z', finishedAt: null, error: null }

describe('projectRun goal', () => {
    it('returns the goal of the run unchanged', () => {
        const goal = { lastLineForms: [{ prefix: 'PR: ', rest: 'pull-url' as const }], turnLimit: 3, state: 'met' as const, verdicts: [{ turn: 1, met: true, reason: 'ok' }] }
        expect(projectRun({ ...base, goal }).goal).toEqual(goal)
    })

    it('returns null for a run without a goal', () => {
        expect(projectRun(base).goal).toBeNull()
        expect(projectRun({ ...base, goal: null }).goal).toBeNull()
    })
})

describe('projectRun cached tokens', () => {
    it('carries the cached input tokens of a run', () => {
        expect(projectRun({ ...base, inputTokens: 1000, cachedInputTokens: 800 }).cachedInputTokens).toBe(800)
        expect(projectRun({ ...base, cachedInputTokens: null }).cachedInputTokens).toBeNull()
        expect(projectRun(base).cachedInputTokens).toBeNull()
        expect(Object.keys(projectRun(base))).toEqual(['runId', 'status', 'sessionId', 'provider', 'model', 'trigger', 'steps', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'startedAt', 'finishedAt', 'error', 'goal', 'compactions', 'compactSummaryChars', 'compactAtTokens', 'handoverPath'])
    })
})

describe('projectRun compaction', () => {
    it('carries the compaction count, summary size and trigger point of a run', () => {
        expect(projectRun({ ...base, compactions: 2, compactSummaryChars: 9000, compactAtTokens: 240000 })).toMatchObject({ compactions: 2, compactSummaryChars: 9000, compactAtTokens: 240000 })
        expect(projectRun(base)).toMatchObject({ compactions: null, compactSummaryChars: null, compactAtTokens: null })
    })
})

describe('projectRun handover', () => {
    it('carries the path of the last handover note, or null', () => {
        expect(projectRun({ ...base, handoverPath: '/d/shared/handover/a/r-1.md' })).toMatchObject({ handoverPath: '/d/shared/handover/a/r-1.md' })
        expect(projectRun(base)).toMatchObject({ handoverPath: null })
    })
})
