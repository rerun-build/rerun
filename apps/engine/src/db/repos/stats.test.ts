import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-stats-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { getSystemDb } = await import('../systemDb.js')
const { aggregateStats } = await import('./stats.js')
import type { StatsRepoQuery } from './stats.js'
import type { StatsPoint } from '@rerun/contracts'

const AGENT = 'stats'

beforeAll(async () => {
    const { client } = await getSystemDb(AGENT)
    await client.executeMultiple(`
INSERT INTO runs (id, agent_id, session_id, status, started_at, finished_at, model, trigger_source, total_tokens, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_micros) VALUES
    ('r1', 'stats', 's', 'done', '2026-09-01T10:15:00.000Z', '2026-09-01T10:15:02.000Z', 'opus', 'chat', 30, 10, 20, 5, 1, 100),
    ('r2', 'stats', 's', 'error', '2026-09-01T10:45:00.000Z', '2026-09-01T10:45:04.000Z', 'opus', 'schedule', 10, 4, 6, 0, 0, 50),
    ('r3', 'stats', 's', 'running', '2026-09-01T11:05:00.000Z', NULL, 'haiku', 'chat', NULL, NULL, NULL, NULL, NULL, NULL),
    ('r4', 'stats', 's', 'done', '2026-09-02T09:00:00.000Z', '2026-09-02T09:00:06.000Z', 'haiku', NULL, 5, 2, 3, NULL, NULL, NULL),
    ('rx', 'someone-else', 's', 'done', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:01.000Z', 'opus', 'chat', 999, 999, 999, 999, 999, 999);

INSERT INTO run_steps (id, run_id, agent_id, session_id, step_number, model, finish_reason, input_tokens, output_tokens, total_tokens, duration_ms, created_at) VALUES
    ('st1', 'r1', 'stats', 's', 0, 'opus', 'tool-calls', 3, 4, 7, 100, '2026-09-01T10:15:01.000Z'),
    ('st2', 'r1', 'stats', 's', 1, 'opus', 'stop', 7, 16, 23, 300, '2026-09-01T10:15:02.000Z'),
    ('st3', 'r4', 'stats', 's', 0, 'haiku', 'stop', 2, 3, 5, NULL, '2026-09-02T09:00:05.000Z');

INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_name, is_error, duration_ms, created_at) VALUES
    ('t1', 'r1', 'stats', 's', 0, 'web_search', 0, 10, '2026-09-01T10:15:01.000Z'),
    ('t2', 'r1', 'stats', 's', 0, 'web_search', 1, 30, '2026-09-01T10:15:01.500Z'),
    ('t3', 'r1', 'stats', 's', 0, 'read_file', 0, 20, '2026-09-01T10:15:01.600Z'),
    ('t4', 'r4', 'stats', 's', 0, 'read_file', 1, NULL, '2026-09-02T09:00:05.000Z');

INSERT INTO sessions (id, agent_id, title, status, source, created_at, updated_at) VALUES
    ('se1', 'stats', 't', 'open', 'dashboard', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z'),
    ('se2', 'stats', 't', 'closed', 'schedule', '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z'),
    ('se3', 'stats', 't', 'open', 'schedule', '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z');
`)
})

function query(partial: Partial<StatsRepoQuery> & Pick<StatsRepoQuery, 'dataset' | 'metric'>): StatsRepoQuery {
    return { groupBy: 'none', sinceIso: null, bucket: 'day', ...partial }
}

async function valuesByDay(q: StatsRepoQuery, agentId = AGENT): Promise<Record<string, number>> {
    const points = await aggregateStats(agentId, q)
    return Object.fromEntries(points.map(point => [point.bucket, Number(point.value)]))
}

function byGroup(points: StatsPoint[]): Record<string, number> {
    return Object.fromEntries(points.map(point => [`${point.bucket}|${point.group}`, Number(point.value)]))
}

describe('aggregateStats on runs', () => {
    it('computes every metric per day for this agent only', async () => {
        const expected: Record<string, Record<string, number>> = {
            count: { '2026-09-01': 3, '2026-09-02': 1 },
            totalTokens: { '2026-09-01': 40, '2026-09-02': 5 },
            inputTokens: { '2026-09-01': 14, '2026-09-02': 2 },
            outputTokens: { '2026-09-01': 26, '2026-09-02': 3 },
            cachedInputTokens: { '2026-09-01': 5, '2026-09-02': 0 },
            reasoningTokens: { '2026-09-01': 1, '2026-09-02': 0 },
            cost: { '2026-09-01': 150, '2026-09-02': 0 },
            errorCount: { '2026-09-01': 1, '2026-09-02': 0 },
        }
        for (const [metric, values] of Object.entries(expected)) {
            expect(await valuesByDay(query({ dataset: 'runs', metric: metric as StatsRepoQuery['metric'] })), metric).toEqual(values)
        }

        const rate = await valuesByDay(query({ dataset: 'runs', metric: 'errorRate' }))
        expect(rate['2026-09-01']).toBeCloseTo(1 / 3)
        expect(rate['2026-09-02']).toBe(0)
    })

    it('averages the duration over finished runs only', async () => {
        const points = await aggregateStats(AGENT, query({ dataset: 'runs', metric: 'avgDurationMs' }))
        expect(points.map(point => [point.bucket, point.count])).toEqual([
            ['2026-09-01', 2],
            ['2026-09-02', 1],
        ])
        expect(Number(points[0].value)).toBeCloseTo(3000, 0)
        expect(Number(points[1].value)).toBeCloseTo(6000, 0)
    })

    it('buckets by hour', async () => {
        const points = await aggregateStats(AGENT, query({ dataset: 'runs', metric: 'count', bucket: 'hour' }))
        expect(points.map(point => [point.bucket, point.group, Number(point.value), Number(point.count)])).toEqual([
            ['2026-09-01T10:00', null, 2, 2],
            ['2026-09-01T11:00', null, 1, 1],
            ['2026-09-02T09:00', null, 1, 1],
        ])
    })

    it('filters by run status, all meaning no filter', async () => {
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'count', status: 'done' }))).toEqual({ '2026-09-01': 1, '2026-09-02': 1 })
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'count', status: 'running' }))).toEqual({ '2026-09-01': 1 })
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'count', status: 'all' }))).toEqual({ '2026-09-01': 3, '2026-09-02': 1 })
    })

    it('drops rows before sinceIso', async () => {
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'count', sinceIso: '2026-09-01T10:30:00.000Z' }))).toEqual({ '2026-09-01': 2, '2026-09-02': 1 })
    })

    it('groups by model, status and trigger source', async () => {
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'runs', metric: 'count', groupBy: 'model' })))).toEqual({
            '2026-09-01|opus': 2,
            '2026-09-01|haiku': 1,
            '2026-09-02|haiku': 1,
        })
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'runs', metric: 'count', groupBy: 'status' })))).toEqual({
            '2026-09-01|done': 1,
            '2026-09-01|error': 1,
            '2026-09-01|running': 1,
            '2026-09-02|done': 1,
        })
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'runs', metric: 'totalTokens', groupBy: 'triggerSource' })))).toEqual({
            '2026-09-01|chat': 30,
            '2026-09-01|schedule': 10,
            '2026-09-02|null': 5,
        })
    })
})

describe('failure stats on runs', () => {
    const FAIL = 'failures'
    const GOAL = '{"lastLineForms":[{"prefix":"DONE: ","rest":"sentence"}],"turnLimit":1}'

    beforeAll(async () => {
        const { client } = await getSystemDb(FAIL)
        await client.executeMultiple(`
INSERT INTO runs (id, agent_id, session_id, status, started_at, finished_at, model, goal_json, goal_state) VALUES
    ('f1', 'failures', 'sa', 'done', '2026-09-03T10:00:00.000Z', '2026-09-03T10:01:00.000Z', 'opus', NULL, NULL),
    ('f2', 'failures', 'sb', 'done', '2026-09-03T11:00:00.000Z', '2026-09-03T11:01:00.000Z', 'opus', NULL, NULL),
    ('f3', 'failures', 'sc', 'done', '2026-09-03T12:00:00.000Z', '2026-09-03T12:01:00.000Z', 'haiku', NULL, NULL),
    ('f4', 'failures', 'sd', 'error', '2026-09-03T13:00:00.000Z', '2026-09-03T13:01:00.000Z', 'opus', NULL, NULL),
    ('f5', 'failures', 'se', 'cancelled', '2026-09-03T14:00:00.000Z', '2026-09-03T14:01:00.000Z', 'opus', NULL, NULL),
    ('f6', 'failures', 'sf', 'running', '2026-09-03T15:00:00.000Z', NULL, 'opus', NULL, NULL),
    ('g1', 'failures', 'sg', 'done', '2026-09-04T09:00:00.000Z', '2026-09-04T09:01:00.000Z', 'opus', '${GOAL}', 'not_met'),
    ('g2', 'failures', 'shared', 'done', '2026-09-04T10:00:00.000Z', '2026-09-04T10:01:00.000Z', 'opus', '${GOAL}', 'met'),
    ('g3', 'failures', 'shared', 'done', '2026-09-04T11:00:00.000Z', '2026-09-04T11:01:00.000Z', 'opus', NULL, NULL),
    ('g4', 'failures', 'sh', 'running', '2026-09-04T12:00:00.000Z', NULL, 'opus', '${GOAL}', 'running');
`)
        const said: [string, string, string, unknown][] = [
            ['sa', 'assistant', '2026-09-03T10:00:10.000Z', 'BLOCKED: an early guess'],
            ['sa', 'assistant', '2026-09-03T10:00:50.000Z', 'All good\nTools: read_file'],
            ['sb', 'user', '2026-09-03T11:00:01.000Z', 'go'],
            ['sb', 'assistant', '2026-09-03T11:00:50.000Z', 'Tried twice\nBLOCKED: no key for the store\n\nTools: web_search, read_file\n'],
            ['sc', 'assistant', '2026-09-03T12:00:50.000Z', [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Looked around' }, { type: 'text', text: 'ESCALATE: the spec contradicts itself' }]],
            ['sg', 'assistant', '2026-09-04T09:00:50.000Z', 'DONE: but no'],
            ['shared', 'assistant', '2026-09-04T10:00:50.000Z', 'BLOCKED: at first\nDONE: shipped it'],
            ['shared', 'assistant', '2026-09-04T11:00:50.000Z', 'ESCALATE: stuck on the second job'],
        ]
        for (const [i, [sessionId, role, createdAt, content]] of said.entries()) {
            await client.execute({ sql: 'INSERT INTO messages (id, session_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)', args: [`m${i}`, sessionId, role, JSON.stringify(content), createdAt] })
        }
    })

    it('counts errors, cancels, unmet goals and stop lines as failures, running runs in the base', async () => {
        const points = await aggregateStats(FAIL, query({ dataset: 'runs', metric: 'failureCount' }))
        expect(points.map(point => [point.bucket, Number(point.value), Number(point.count)])).toEqual([
            ['2026-09-03', 4, 6],
            ['2026-09-04', 2, 4],
        ])
        const rate = await valuesByDay(query({ dataset: 'runs', metric: 'failureRate' }), FAIL)
        expect(rate['2026-09-03']).toBeCloseTo(4 / 6)
        expect(rate['2026-09-04']).toBeCloseTo(2 / 4)
    })

    it('reads a run’s final message from its own session when another session speaks in the same minutes', async () => {
        const OVERLAP = 'overlap'
        const { client } = await getSystemDb(OVERLAP)
        await client.executeMultiple(`
INSERT INTO runs (id, agent_id, session_id, status, started_at, finished_at, model) VALUES
    ('o1', 'overlap', 'so1', 'done', '2026-09-05T10:00:00.000Z', '2026-09-05T10:10:00.000Z', 'opus'),
    ('o2', 'overlap', 'so2', 'done', '2026-09-05T10:02:00.000Z', '2026-09-05T10:12:00.000Z', 'opus');
`)
        const said: [string, string, string][] = [
            ['so1', '2026-09-05T10:05:00.000Z', 'All good'],
            ['so2', '2026-09-05T10:09:00.000Z', 'BLOCKED: a first guess'],
            ['so2', '2026-09-05T10:11:00.000Z', 'Done after all'],
        ]
        for (const [i, [sessionId, createdAt, content]] of said.entries()) {
            await client.execute({ sql: 'INSERT INTO messages (id, session_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)', args: [`o${i}`, sessionId, 'assistant', JSON.stringify(content), createdAt] })
        }
        const points = await aggregateStats(OVERLAP, query({ dataset: 'runs', metric: 'failureCount' }))
        expect(points.map(point => [point.bucket, Number(point.value), Number(point.count)])).toEqual([['2026-09-05', 0, 2]])
    })

    it('leaves the error rate as it was', async () => {
        const points = await aggregateStats(FAIL, query({ dataset: 'runs', metric: 'errorRate' }))
        expect(points.map(point => [point.bucket, Number(point.value)])).toEqual([
            ['2026-09-03', 1 / 6],
            ['2026-09-04', 0],
        ])
    })

    it('groups failures and honours the status filter and sinceIso', async () => {
        expect(byGroup(await aggregateStats(FAIL, query({ dataset: 'runs', metric: 'failureCount', groupBy: 'model' })))).toEqual({
            '2026-09-03|opus': 3,
            '2026-09-03|haiku': 1,
            '2026-09-04|opus': 2,
        })
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'failureCount', status: 'done' }), FAIL)).toEqual({ '2026-09-03': 2, '2026-09-04': 2 })
        expect(await valuesByDay(query({ dataset: 'runs', metric: 'failureCount', sinceIso: '2026-09-04T10:00:00.000Z' }), FAIL)).toEqual({ '2026-09-04': 1 })
    })
})

describe('aggregateStats on run steps', () => {
    it('computes every metric per day', async () => {
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'count' }))).toEqual({ '2026-09-01': 2, '2026-09-02': 1 })
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'totalTokens' }))).toEqual({ '2026-09-01': 30, '2026-09-02': 5 })
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'inputTokens' }))).toEqual({ '2026-09-01': 10, '2026-09-02': 2 })
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'outputTokens' }))).toEqual({ '2026-09-01': 20, '2026-09-02': 3 })
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'avgDurationMs' }))).toEqual({ '2026-09-01': 200, '2026-09-02': 0 })
    })

    it('groups by model, finish reason and step number', async () => {
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'runSteps', metric: 'count', groupBy: 'model' })))).toEqual({ '2026-09-01|opus': 2, '2026-09-02|haiku': 1 })
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'runSteps', metric: 'count', groupBy: 'finishReason' })))).toEqual({
            '2026-09-01|tool-calls': 1,
            '2026-09-01|stop': 1,
            '2026-09-02|stop': 1,
        })
        const steps = await aggregateStats(AGENT, query({ dataset: 'runSteps', metric: 'count', groupBy: 'stepNumber' }))
        expect(byGroup(steps)).toEqual({ '2026-09-01|0': 1, '2026-09-01|1': 1, '2026-09-02|0': 1 })
        expect(steps.every(point => typeof point.group === 'string')).toBe(true)
    })

    it('ignores the run status filter', async () => {
        expect(await valuesByDay(query({ dataset: 'runSteps', metric: 'count', status: 'error' }))).toEqual({ '2026-09-01': 2, '2026-09-02': 1 })
    })
})

describe('aggregateStats on tool calls', () => {
    it('computes every metric per day', async () => {
        expect(await valuesByDay(query({ dataset: 'toolCalls', metric: 'count' }))).toEqual({ '2026-09-01': 3, '2026-09-02': 1 })
        expect(await valuesByDay(query({ dataset: 'toolCalls', metric: 'errorCount' }))).toEqual({ '2026-09-01': 1, '2026-09-02': 1 })
        const rate = await valuesByDay(query({ dataset: 'toolCalls', metric: 'errorRate' }))
        expect(rate['2026-09-01']).toBeCloseTo(1 / 3)
        expect(rate['2026-09-02']).toBe(1)
        expect(await valuesByDay(query({ dataset: 'toolCalls', metric: 'avgDurationMs' }))).toEqual({ '2026-09-01': 20, '2026-09-02': 0 })
    })

    it('groups by tool name', async () => {
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'toolCalls', metric: 'count', groupBy: 'toolName' })))).toEqual({
            '2026-09-01|web_search': 2,
            '2026-09-01|read_file': 1,
            '2026-09-02|read_file': 1,
        })
    })
})

describe('aggregateStats on sessions', () => {
    it('counts per day, grouped by source or status', async () => {
        expect(await valuesByDay(query({ dataset: 'sessions', metric: 'count' }))).toEqual({ '2026-09-01': 2, '2026-09-02': 1 })
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'sessions', metric: 'count', groupBy: 'source' })))).toEqual({
            '2026-09-01|dashboard': 1,
            '2026-09-01|schedule': 1,
            '2026-09-02|schedule': 1,
        })
        expect(byGroup(await aggregateStats(AGENT, query({ dataset: 'sessions', metric: 'count', groupBy: 'status' })))).toEqual({
            '2026-09-01|open': 1,
            '2026-09-01|closed': 1,
            '2026-09-02|open': 1,
        })
    })
})

describe('aggregateStats with an unsupported combination', () => {
    it('throws for a metric the dataset does not have', async () => {
        await expect(aggregateStats(AGENT, query({ dataset: 'sessions', metric: 'cost' }))).rejects.toThrow('unsupported metric cost for dataset sessions')
        await expect(aggregateStats(AGENT, query({ dataset: 'runSteps', metric: 'errorRate' }))).rejects.toThrow('unsupported metric errorRate for dataset runSteps')
    })

    it('throws for a groupBy the dataset does not have', async () => {
        await expect(aggregateStats(AGENT, query({ dataset: 'sessions', metric: 'count', groupBy: 'model' }))).rejects.toThrow('unsupported groupBy model for dataset sessions')
        await expect(aggregateStats(AGENT, query({ dataset: 'toolCalls', metric: 'count', groupBy: 'status' }))).rejects.toThrow('unsupported groupBy status for dataset toolCalls')
    })
})
