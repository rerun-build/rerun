import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-wsusage-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { getSystemDb } = await import('../../db/systemDb.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { saveReadings } = await import('../../connections/plan-readings.js')

const app = createServer()

type Step = { run: string; job: string | null; provider: string; model: string; at: string; input: number; cached: number; write: number; output: number }

async function addAgent(id: string, steps: Step[], tools: [string, number][]) {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
    const { client } = await getSystemDb(id)
    const seen = new Set<string>()
    let n = 0
    for (const s of steps) {
        if (!seen.has(s.run)) {
            seen.add(s.run)
            await client.execute({
                sql: 'INSERT INTO runs (id, agent_id, session_id, started_at, job_ref) VALUES (?, ?, ?, ?, ?)',
                args: [s.run, id, 's', s.at, s.job],
            })
        }
        n += 1
        await client.execute({
            sql: 'INSERT INTO run_steps (id, run_id, agent_id, session_id, step_number, provider, model, input_tokens, output_tokens, cached_input_tokens, cache_write_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [`${id}-st${n}`, s.run, id, 's', n, s.provider, s.model, s.input, s.output, s.cached, s.write, s.at],
        })
    }
    for (const [i, [name, isError]] of tools.entries()) {
        await client.execute({
            sql: 'INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_name, is_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            args: [`${id}-tc${i}`, 'r1', id, 's', 1, name, isError, '2026-11-10T10:00:00.000Z'],
        })
    }
}

async function seed() {
    await addAgent(
        'usea',
        [
            { run: 'r1', job: 'rerun#40', provider: 'claude', model: 'm1', at: '2026-11-10T10:00:00.000Z', input: 1000, cached: 700, write: 100, output: 50 },
            { run: 'r2', job: null, provider: 'claude', model: 'm1', at: '2026-11-10T12:00:00.000Z', input: 500, cached: 0, write: 0, output: 20 },
            { run: 'r4', job: null, provider: 'openrouter', model: 'm2', at: '2026-11-10T10:20:00.000Z', input: 80, cached: 0, write: 0, output: 20 },
        ],
        [['Bash', 0], ['Bash', 1]],
    )
    await addAgent(
        'useb',
        [{ run: 'r3', job: 'rerun#40', provider: 'claude', model: 'm1', at: '2026-11-10T10:10:00.000Z', input: 300, cached: 100, write: 50, output: 10 }],
        [['Bash', 0]],
    )
    const reset = '2026-11-17T00:00:00.000Z'
    await saveReadings('c0', [{ kind: 'weekly', label: 'weekly', usedPercent: 50, resetsAt: reset }], '2026-11-01T00:00:00.000Z')
    await saveReadings('c1', [{ kind: 'weekly', label: 'weekly', usedPercent: 10, resetsAt: reset }], '2026-11-10T09:00:00.000Z')
    await saveReadings('c1', [{ kind: 'weekly', label: 'weekly', usedPercent: 12, resetsAt: reset }], '2026-11-10T11:00:00.000Z')
}

describe('GET /usage', () => {
    it('answers an empty workspace', async () => {
        const res = await app.request('/usage?range=all')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ range: 'all', weekly: null, groups: [], tools: [], unassignedPoints: 0 })
    })

    it('rejects an unknown range', async () => {
        const res = await app.request('/usage?range=year')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'invalid range' })
    })

    it('joins tokens, tool calls and weekly points', async () => {
        await seed()
        const res = await app.request('/usage?range=all')
        expect(res.status).toBe(200)
        const body = (await res.json()) as Record<string, unknown>
        expect(body.weekly).toEqual({ connectionId: 'c1', usedPercent: 12, resetsAt: '2026-11-17T00:00:00.000Z', capturedAt: '2026-11-10T11:00:00.000Z' })
        expect(body.groups).toEqual([
            { agentId: 'usea', jobRef: 'rerun#40', provider: 'claude', model: 'm1', runs: 1, steps: 1, freshInput: 200, output: 50, cacheWrite: 100, cacheRead: 700, total: 1050, points: 1.54 },
            { agentId: 'usea', jobRef: null, provider: 'claude', model: 'm1', runs: 1, steps: 1, freshInput: 500, output: 20, cacheWrite: 0, cacheRead: 0, total: 520, points: 0 },
            { agentId: 'useb', jobRef: 'rerun#40', provider: 'claude', model: 'm1', runs: 1, steps: 1, freshInput: 150, output: 10, cacheWrite: 50, cacheRead: 100, total: 310, points: 0.46 },
            { agentId: 'usea', jobRef: null, provider: 'openrouter', model: 'm2', runs: 1, steps: 1, freshInput: 80, output: 20, cacheWrite: 0, cacheRead: 0, total: 100, points: null },
        ])
        expect(body.tools).toEqual([
            { agentId: 'usea', toolName: 'Bash', calls: 2, errors: 1 },
            { agentId: 'useb', toolName: 'Bash', calls: 1, errors: 0 },
        ])
        expect(body.unassignedPoints).toBe(0)
    })

    it('keeps the range', async () => {
        const res = await app.request('/usage?range=24h')
        expect(res.status).toBe(200)
        expect(((await res.json()) as { groups: unknown[] }).groups).toEqual([])
    })
})
