import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-usage-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { createSession } = await import('../../db/repos/sessions.js')
const { setRunStarter, startRun } = await import('../../db/repos/runs.js')
const { touchMember } = await import('../../db/repos/members.js')
const { getSystemDb } = await import('../../db/systemDb.js')

const app = createServer()
const hour = 3600_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

type Seed = { status?: string; startedAt: string; finishedAt?: string; triggerSource?: string; triggerSlug?: string; costMicros?: number | null; inputTokens?: number; outputTokens?: number; model?: string }

async function seedRun(agentId: string, sessionId: string, seed: Seed): Promise<string> {
    const run = await startRun(agentId, sessionId)
    const { client } = await getSystemDb(agentId)
    await client.execute({
        sql: 'UPDATE runs SET status = ?, started_at = ?, finished_at = ?, trigger_source = ?, trigger_slug = ?, cost_micros = ?, input_tokens = ?, output_tokens = ?, model = ? WHERE id = ?',
        args: [seed.status ?? 'done', seed.startedAt, seed.finishedAt ?? seed.startedAt, seed.triggerSource ?? null, seed.triggerSlug ?? null, seed.costMicros ?? null, seed.inputTokens ?? 0, seed.outputTokens ?? 0, seed.model ?? null, run.id],
    })
    return run.id
}

async function addAgent(id: string) {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
}

async function usage(query: Record<string, string>) {
    const res = await app.request(`/usage/runs?${new URLSearchParams(query)}`)
    return { status: res.status, body: (await res.json()) as { runs: { id: string; agentId: string; status: string; costMicros: number | null; inputTokens: number; starterKind: string | null; starterId: string | null; starterName: string | null }[]; truncated: boolean } }
}

const window = () => ({ from: ago(7 * 24 * hour), to: new Date().toISOString() })

const ids: Record<string, string> = {}

beforeAll(async () => {
    await addAgent('nova')
    await addAgent('atlas')
    await addAgent('empty')
    await touchMember({ id: 'user-noa', name: 'Noa Levi' })

    const nova = await createSession('nova')
    ids.person = await seedRun('nova', nova.id, { startedAt: ago(hour), costMicros: 30_000, inputTokens: 1200, outputTokens: 80, model: 'anthropic/claude-sonnet-4.5' })
    await setRunStarter('nova', ids.person, { kind: 'person', id: 'user-noa' })
    ids.unpriced = await seedRun('nova', nova.id, { startedAt: ago(2 * hour), costMicros: null, inputTokens: 500 })
    ids.oldSchedule = await seedRun('nova', nova.id, { startedAt: ago(3 * hour), triggerSource: 'schedule', triggerSlug: 'daily' })
    ids.ancient = await seedRun('nova', nova.id, { startedAt: ago(40 * 24 * hour) })
    ids.running = await seedRun('nova', nova.id, { status: 'running', startedAt: ago(60 * 24 * hour) })
    ids.lateFinish = await seedRun('nova', nova.id, { startedAt: ago(50 * 24 * hour), finishedAt: ago(hour / 6) })

    const atlas = await createSession('atlas', 'from nova', undefined, 'agent')
    const { client } = await getSystemDb('atlas')
    await client.execute({ sql: 'UPDATE sessions SET origin_agent_id = ? WHERE id = ?', args: ['nova', atlas.id] })
    ids.oldCall = await seedRun('atlas', atlas.id, { startedAt: ago(4 * hour), triggerSource: 'chat' })
    const direct = await createSession('atlas')
    ids.oldChat = await seedRun('atlas', direct.id, { startedAt: ago(5 * hour), triggerSource: 'chat' })
})

describe('GET /usage/runs', () => {
    it('reads the runs of every coworker in the window, newest first, plus the ones still running', async () => {
        const { status, body } = await usage(window())
        expect(status).toBe(200)
        expect(body.truncated).toBe(false)
        expect(body.runs.map(run => run.id)).toEqual([ids.person, ids.unpriced, ids.oldSchedule, ids.oldCall, ids.oldChat, ids.running])
        expect(new Set(body.runs.map(run => run.agentId))).toEqual(new Set(['nova', 'atlas']))
    })

    it('keeps an unknown price unknown instead of zero', async () => {
        const { body } = await usage(window())
        const byId = new Map(body.runs.map(run => [run.id, run]))
        expect(byId.get(ids.person)).toMatchObject({ costMicros: 30_000, inputTokens: 1200 })
        expect(byId.get(ids.unpriced)).toMatchObject({ costMicros: null, inputTokens: 500 })
    })

    it('names who started a run, and leaves an old chat not recorded', async () => {
        const { body } = await usage(window())
        const byId = new Map(body.runs.map(run => [run.id, run]))
        expect(byId.get(ids.person)).toMatchObject({ starterKind: 'person', starterId: 'user-noa', starterName: 'Noa Levi' })
        expect(byId.get(ids.oldSchedule)).toMatchObject({ starterKind: 'schedule', starterId: 'daily', starterName: null })
        expect(byId.get(ids.oldCall)).toMatchObject({ starterKind: 'coworker', starterId: 'nova' })
        expect(byId.get(ids.oldChat)).toMatchObject({ starterKind: null, starterId: null })
    })

    it('with since, keeps only what changed after it and what still runs', async () => {
        const { body } = await usage({ ...window(), since: ago(1.5 * hour) })
        expect(body.runs.map(run => run.id)).toEqual([ids.person, ids.lateFinish, ids.running])
    })

    it('with since, hands back the end of a run that started before the window', async () => {
        const { body } = await usage({ ...window(), since: ago(hour / 3) })
        expect(body.runs.find(run => run.id === ids.lateFinish)).toMatchObject({ status: 'done' })
        const { body: whole } = await usage(window())
        expect(whole.runs.map(run => run.id)).not.toContain(ids.lateFinish)
    })

    it('reads only the coworkers it is given', async () => {
        const { body } = await usage({ ...window(), agents: 'atlas,ghost' })
        expect(body.runs.map(run => run.id)).toEqual([ids.oldCall, ids.oldChat])
    })

    it('refuses a window that ends before it starts', async () => {
        const { status } = await usage({ from: new Date().toISOString(), to: ago(hour) })
        expect(status).toBe(400)
    })
})
