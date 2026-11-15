import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-telemetry-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { insertRunStep, insertToolCall, listRunSteps, listToolCalls } = await import('./telemetry.js')
import type { RunStepRow, ToolCallRow } from '../schema.js'

function step(id: string, runId: string, stepNumber: number): RunStepRow {
    return {
        id,
        runId,
        agentId: 'agent',
        sessionId: 's',
        stepNumber,
        provider: 'anthropic',
        model: 'm',
        finishReason: 'stop',
        inputTokens: 1,
        outputTokens: 2,
        cachedInputTokens: null,
        reasoningTokens: null,
        totalTokens: 3,
        cacheWriteTokens: null,
        costMicros: null,
        effort: null,
        toolCallCount: 0,
        textLength: 0,
        durationMs: 10,
        createdAt: '2026-09-01T00:00:00.000Z',
    }
}

function call(id: string, runId: string, createdAt: string): ToolCallRow {
    return {
        id,
        runId,
        agentId: 'agent',
        sessionId: 's',
        stepNumber: 0,
        toolCallId: `tc-${id}`,
        toolName: 'web_search',
        inputJson: '{}',
        resultJson: null,
        isError: 0,
        durationMs: 5,
        createdAt,
    }
}

describe('run telemetry', () => {
    it('lists the steps of one run by step number', async () => {
        await insertRunStep('agent', step('c', 'r1', 2))
        await insertRunStep('agent', step('a', 'r1', 0))
        await insertRunStep('agent', step('b', 'r1', 1))
        await insertRunStep('agent', step('x', 'r2', 0))

        const steps = await listRunSteps('agent', 'r1')
        expect(steps.map(row => row.id)).toEqual(['a', 'b', 'c'])
        expect(steps[0]).toEqual(step('a', 'r1', 0))
    })

    it('stores the effort of a step and reads it back', async () => {
        await insertRunStep('agent', { ...step('hi', 'r3', 0), effort: 'high' })
        await insertRunStep('agent', { ...step('none', 'r3', 1), effort: null })

        const steps = await listRunSteps('agent', 'r3')
        expect(steps.map(row => row.effort)).toEqual(['high', null])
    })

    it('lists the tool calls of one run by creation time', async () => {
        await insertToolCall('agent', call('late', 'r1', '2026-09-01T00:00:03.000Z'))
        await insertToolCall('agent', call('early', 'r1', '2026-09-01T00:00:01.000Z'))
        await insertToolCall('agent', call('mid', 'r1', '2026-09-01T00:00:02.000Z'))
        await insertToolCall('agent', call('other', 'r2', '2026-09-01T00:00:00.000Z'))

        const calls = await listToolCalls('agent', 'r1')
        expect(calls.map(row => row.id)).toEqual(['early', 'mid', 'late'])
        expect(calls[0]).toEqual(call('early', 'r1', '2026-09-01T00:00:01.000Z'))
    })

    it('is empty for an unknown run', async () => {
        expect(await listRunSteps('agent', 'nope')).toEqual([])
        expect(await listToolCalls('agent', 'nope')).toEqual([])
    })
})
