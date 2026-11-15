import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-usage-steps-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { getSystemDb, systemDbExists } = await import('../systemDb.js')
const { groupUsage, listToolCallCounts, listUsageSteps } = await import('./usage-steps.js')
import type { UsageStep } from './usage-steps.js'

const SINCE = '2026-11-01T00:00:00.000Z'

async function seed(agent: string, runsSql: string, stepsSql: string, callsSql: string) {
    const { client } = await getSystemDb(agent)
    await client.executeMultiple(`${runsSql}\n${stepsSql}\n${callsSql}`)
}

beforeAll(async () => {
    await seed(
        'usea',
        `INSERT INTO runs (id, agent_id, session_id, status, started_at, job_ref) VALUES
    ('r1', 'usea', 's', 'done', '2026-11-10T10:00:00.000Z', 'rerun#40'),
    ('r2', 'usea', 's', 'done', '2026-11-10T11:00:00.000Z', NULL);`,
        `INSERT INTO run_steps (id, run_id, agent_id, session_id, step_number, provider, model, input_tokens, output_tokens, cached_input_tokens, cache_write_tokens, created_at) VALUES
    ('s1', 'r1', 'usea', 's', 0, 'claude', 'm1', 1000, 50, 700, 100, '2026-11-10T10:00:00.000Z'),
    ('s0', 'r1', 'usea', 's', 1, 'claude', 'm1', 40, 5, NULL, NULL, '2026-10-01T00:00:00.000Z'),
    ('s2', 'r2', 'usea', 's', 0, 'claude', 'm1', 500, 20, 0, 0, '2026-11-10T11:00:00.000Z');`,
        `INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_name, is_error, created_at) VALUES
    ('c1', 'r1', 'usea', 's', 0, 'Bash', 0, '2026-11-10T10:00:00.000Z'),
    ('c2', 'r1', 'usea', 's', 0, 'Bash', 1, '2026-11-10T10:00:01.000Z'),
    ('c3', 'r1', 'usea', 's', 0, 'Bash', 0, '2026-11-10T10:00:02.000Z'),
    ('c4', 'r1', 'usea', 's', 0, 'Read', 0, '2026-11-10T10:00:03.000Z');`,
    )
    await seed(
        'useb',
        `INSERT INTO runs (id, agent_id, session_id, status, started_at, job_ref) VALUES
    ('r3', 'useb', 's', 'done', '2026-11-10T10:10:00.000Z', 'rerun#40');`,
        `INSERT INTO run_steps (id, run_id, agent_id, session_id, step_number, provider, model, input_tokens, output_tokens, cached_input_tokens, cache_write_tokens, created_at) VALUES
    ('s3', 'r3', 'useb', 's', 0, 'claude', 'm1', 300, 10, 100, 50, '2026-11-10T10:10:00.000Z');`,
        `INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_name, is_error, created_at) VALUES
    ('d1', 'r3', 'useb', 's', 0, 'Bash', 0, '2026-11-10T10:10:00.000Z'),
    ('d2', 'r3', 'useb', 's', 0, 'Bash', 0, '2026-11-10T10:10:01.000Z'),
    ('d3', 'r3', 'useb', 's', 0, 'Bash', 0, '2026-10-01T00:00:00.000Z');`,
    )
})

describe('usage steps', () => {
    it('lists steps since a date with the four kinds and skips an agent without a database', async () => {
        const steps = await listUsageSteps(['usea', 'useb', 'usec'], SINCE)
        expect(steps.map(s => s.runId)).toEqual(['r1', 'r3', 'r2'])
        const pick = (s: UsageStep) => [s.freshInput, s.output, s.cacheWrite, s.cacheRead]
        expect(pick(steps[0]!)).toEqual([200, 50, 100, 700])
        expect(pick(steps[2]!)).toEqual([500, 20, 0, 0])
        expect(pick(steps[1]!)).toEqual([150, 10, 50, 100])
        expect(steps[0]).toMatchObject({ agentId: 'usea', jobRef: 'rerun#40', provider: 'claude', model: 'm1', at: '2026-11-10T10:00:00.000Z' })
        expect(steps[2]!.jobRef).toBeNull()
        expect(systemDbExists('usec')).toBe(false)
        expect(await listUsageSteps(['usea', 'useb', 'usec'], null)).toHaveLength(4)
    })

    it('groups by coworker, job, provider and model, biggest first', async () => {
        const groups = groupUsage(await listUsageSteps(['usea', 'useb'], SINCE))
        expect(groups.map(g => `${g.agentId}|${g.jobRef}`)).toEqual(['usea|rerun#40', 'usea|null', 'useb|rerun#40'])
        expect(groups.map(g => g.total)).toEqual([1050, 520, 310])
        for (const g of groups) expect([g.runs, g.steps]).toEqual([1, 1])
    })

    it('adds steps of one key and keeps null keys apart', () => {
        const base = { agentId: 'a', jobRef: 'J', provider: 'claude', model: 'm1', at: '2026-11-10T10:00:00.000Z' }
        const groups = groupUsage([
            { ...base, runId: 'x1', freshInput: 10, output: 5, cacheWrite: 1, cacheRead: 2 },
            { ...base, runId: 'x2', freshInput: 20, output: 0, cacheWrite: 0, cacheRead: 3 },
            { ...base, model: null, runId: 'x3', freshInput: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
        ])
        expect(groups).toHaveLength(2)
        expect(groups[0]).toMatchObject({ freshInput: 30, output: 5, cacheWrite: 1, cacheRead: 5, total: 41, steps: 2, runs: 2 })
        expect(groups[1]).toMatchObject({ model: null, total: 2 })
    })

    it('counts tool calls per coworker and tool', async () => {
        const rows = await listToolCallCounts(['usea', 'useb', 'usec'], SINCE)
        expect(rows).toEqual([
            { agentId: 'usea', toolName: 'Bash', calls: 3, errors: 1 },
            { agentId: 'useb', toolName: 'Bash', calls: 2, errors: 0 },
            { agentId: 'usea', toolName: 'Read', calls: 1, errors: 0 },
        ])
    })
})
