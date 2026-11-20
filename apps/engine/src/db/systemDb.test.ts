import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-systemdb-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, vi } = await import('vitest')
const { createClient } = await import('@libsql/client')
const { SYSTEM_DB_MIGRATIONS, closeSystemDb, getSystemDb, systemDbExists } = await import('./systemDb.js')
const { migrateSqlite, sqliteVersion } = await import('./ladder.js')
const { agentDataDir, systemDbPath } = await import('../config/paths.js')
const { logger } = await import('../lib/logger.js')
const { getAgentDb } = await import('./agentDb.js')
const { buildTools } = await import('../tools/registry.js')
const { agentConfigSchema } = await import('../agents/types.js')

async function columnsOf(agentId: string, table: string): Promise<string[]> {
    const { client } = await getSystemDb(agentId)
    const info = await client.execute(`PRAGMA table_info('${table}')`)
    return info.rows.map(row => String(row.name))
}

async function seedLegacy(agentId: string): Promise<void> {
    mkdirSync(agentDataDir(agentId), { recursive: true })
    const legacy = createClient({ url: `file:${systemDbPath(agentId)}` })
    await legacy.executeMultiple(`
CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'Untitled', status TEXT NOT NULL DEFAULT 'open', origin_agent_id TEXT, origin_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', step_count INTEGER NOT NULL DEFAULT 0, usage_json TEXT, started_at TEXT NOT NULL, finished_at TEXT, error TEXT);
CREATE TABLE memories (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, embedding F32_BLOB(1536), kind TEXT NOT NULL DEFAULT 'note', created_at TEXT NOT NULL);
CREATE TABLE skill_proposals (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT, tool_call_id TEXT NOT NULL, mode TEXT NOT NULL, slug TEXT, title TEXT NOT NULL, summary TEXT NOT NULL, instructions_json TEXT NOT NULL, fingerprints_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', applied_slug TEXT, error TEXT, created_at TEXT NOT NULL, decided_at TEXT);
INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES
    ('s1', 'legacy', 'schedule: daily-digest', '2026-01-01', '2026-01-01'),
    ('s2', 'legacy', 'delegated: summarize', '2026-01-01', '2026-01-01'),
    ('s3', 'legacy', 'from planner', '2026-01-01', '2026-01-01'),
    ('s4', 'legacy', 'Plain chat', '2026-01-01', '2026-01-01'),
    ('s5', 'legacy', 'about schedule: x', '2026-01-01', '2026-01-01');
INSERT INTO memories (id, agent_id, path, content, created_at) VALUES ('m1', 'legacy', 'a.md', 'kept', '2026-01-01');
`)
    legacy.close()
}

describe('getSystemDb on a legacy file', () => {
    it('backfills sessions.source from the title prefix and adds every missing column', async () => {
        await seedLegacy('legacy')

        const { client } = await getSystemDb('legacy')
        const res = await client.execute('SELECT id, source FROM sessions ORDER BY id')
        expect(Object.fromEntries(res.rows.map(row => [row.id, row.source]))).toEqual({
            s1: 'schedule',
            s2: 'delegate',
            s3: 'agent',
            s4: 'dashboard',
            s5: 'dashboard',
        })

        expect(await columnsOf('legacy', 'runs')).toEqual(
            expect.arrayContaining(['provider', 'model', 'trigger_source', 'trigger_slug', 'cost_micros', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_tokens', 'total_tokens']),
        )
        expect(await columnsOf('legacy', 'memories')).toEqual(expect.arrayContaining(['last_accessed_at', 'access_count']))
        expect(await columnsOf('legacy', 'skill_proposals')).toEqual(expect.arrayContaining(['connection_id', 'provider', 'model']))

        const memory = await client.execute("SELECT content, access_count FROM memories WHERE id = 'm1'")
        expect(memory.rows[0]).toMatchObject({ content: 'kept', access_count: 0 })

        const indexes = await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runs'")
        expect(indexes.rows.map(row => row.name)).toEqual(expect.arrayContaining(['runs_agent_started_idx', 'runs_session_started_idx']))
    })

    it('leaves an already backfilled source alone on the next open', async () => {
        const { client } = await getSystemDb('legacy')
        await client.execute("UPDATE sessions SET source = 'trigger' WHERE id = 's1'")
        closeSystemDb('legacy')

        const reopened = await getSystemDb('legacy')
        const res = await reopened.client.execute("SELECT source FROM sessions WHERE id = 's1'")
        expect(res.rows[0].source).toBe('trigger')
    })
})

describe('final message index migration', () => {
    it('lets the read of the final message of a run seek by session, role and time on an existing db', async () => {
        await seedLegacy('finalmsg')
        const db = await getSystemDb('finalmsg')
        const plan = await db.client.execute({
            sql: "EXPLAIN QUERY PLAN SELECT content_json FROM messages WHERE session_id = ? AND role = 'assistant' AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            args: ['s1', '2026-01-01', '2026-01-02'],
        })
        const detail = plan.rows.map(row => String(row.detail)).join(' | ')
        expect(detail).toContain('messages_session_role_created_idx')
        expect(detail).not.toContain('TEMP B-TREE')
    })
})

describe('run lineage migration', () => {
    const LINEAGE = ['initiator_agent_id', 'initiator_run_id', 'initiator_session_id', 'initiator_user_id', 'job_ref', 'branch', 'copy_index']

    it('adds the lineage columns and the job index to an existing db, once', async () => {
        await seedLegacy('lineage')
        const first = await getSystemDb('lineage')
        expect(await columnsOf('lineage', 'runs')).toEqual(expect.arrayContaining(LINEAGE))
        closeSystemDb('lineage')
        const second = await getSystemDb('lineage')
        const indexes = await second.client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runs' AND name = 'runs_agent_job_started_idx'")
        expect(indexes.rows).toHaveLength(1)
        expect(first).not.toBe(second)
    })

    it('upgrades a db already at version 4 and changes nothing on a second open', async () => {
        mkdirSync(agentDataDir('v4'), { recursive: true })
        const old = createClient({ url: `file:${systemDbPath('v4')}` })
        await migrateSqlite(old, SYSTEM_DB_MIGRATIONS.filter(step => step.version <= 4), systemDbPath('v4'))
        expect(await sqliteVersion(old)).toBe(4)
        old.close()

        const first = await getSystemDb('v4')
        const columns = await columnsOf('v4', 'runs')
        expect(columns).toEqual(expect.arrayContaining(LINEAGE))
        const indexSql = "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'runs_agent_job_started_idx'"
        expect((await first.client.execute(indexSql)).rows).toHaveLength(1)
        expect(await sqliteVersion(first.client)).toBe(10)
        closeSystemDb('v4')

        const second = await getSystemDb('v4')
        expect(await columnsOf('v4', 'runs')).toEqual(columns)
        expect((await second.client.execute(indexSql)).rows).toHaveLength(1)
        expect(await sqliteVersion(second.client)).toBe(10)
    })
})

describe('run goal migration', () => {
    const GOAL = ['goal_json', 'goal_state', 'goal_turns', 'goal_verdicts_json']

    it('adds four nullable goal columns to a db at version 5, once', async () => {
        mkdirSync(agentDataDir('v5goal'), { recursive: true })
        const old = createClient({ url: `file:${systemDbPath('v5goal')}` })
        await migrateSqlite(old, SYSTEM_DB_MIGRATIONS.filter(step => step.version <= 5), systemDbPath('v5goal'))
        await old.execute("INSERT INTO runs (id, agent_id, session_id, started_at) VALUES ('r1', 'v5goal', 's', 'x')")
        old.close()

        const first = await getSystemDb('v5goal')
        const columns = await columnsOf('v5goal', 'runs')
        expect(columns).toEqual(expect.arrayContaining(GOAL))
        const row = (await first.client.execute("SELECT goal_json, goal_state, goal_turns, goal_verdicts_json FROM runs WHERE id = 'r1'")).rows[0]
        expect([row.goal_json, row.goal_state, row.goal_turns, row.goal_verdicts_json]).toEqual([null, null, null, null])
        await expect(first.client.execute("UPDATE runs SET goal_state = 'bogus' WHERE id = 'r1'")).rejects.toThrow()
        expect(await sqliteVersion(first.client)).toBe(10)
        expect(SYSTEM_DB_MIGRATIONS.find(step => step.version === 6)).toMatchObject({ version: 6, id: 'run-goal' })
        closeSystemDb('v5goal')
        expect(await columnsOf('v5goal', 'runs')).toEqual(columns)
    })
})

describe('run compactions migration', () => {
    it('adds three nullable columns to a db at version 8, once', async () => {
        mkdirSync(agentDataDir('v8c'), { recursive: true })
        const old = createClient({ url: `file:${systemDbPath('v8c')}` })
        await migrateSqlite(old, SYSTEM_DB_MIGRATIONS.filter(step => step.version <= 8), systemDbPath('v8c'))
        await old.execute("INSERT INTO runs (id, agent_id, session_id, started_at) VALUES ('r1', 'v8c', 's', 'x')")
        old.close()

        const first = await getSystemDb('v8c')
        const columns = await columnsOf('v8c', 'runs')
        expect(columns).toEqual(expect.arrayContaining(['compactions', 'compact_summary_chars', 'compact_at_tokens']))
        const row = (await first.client.execute('SELECT compactions, compact_summary_chars, compact_at_tokens FROM runs WHERE id = \'r1\'')).rows[0]
        expect([row.compactions, row.compact_summary_chars, row.compact_at_tokens]).toEqual([null, null, null])
        expect(await sqliteVersion(first.client)).toBe(10)
        expect(SYSTEM_DB_MIGRATIONS.find(step => step.version === 9)).toMatchObject({ version: 9, id: 'run-compactions' })
        closeSystemDb('v8c')
        expect(await columnsOf('v8c', 'runs')).toEqual(columns)
    })
})

describe('run handover migration', () => {
    it('adds one nullable column to a db at version 9, once', async () => {
        mkdirSync(agentDataDir('v9h'), { recursive: true })
        const old = createClient({ url: `file:${systemDbPath('v9h')}` })
        await migrateSqlite(old, SYSTEM_DB_MIGRATIONS.filter(step => step.version <= 9), systemDbPath('v9h'))
        await old.execute("INSERT INTO runs (id, agent_id, session_id, started_at) VALUES ('r1', 'v9h', 's', 'x')")
        old.close()

        const first = await getSystemDb('v9h')
        const columns = await columnsOf('v9h', 'runs')
        expect(columns).toContain('handover_path')
        const row = (await first.client.execute("SELECT handover_path FROM runs WHERE id = 'r1'")).rows[0]
        expect(row.handover_path).toBeNull()
        expect(await sqliteVersion(first.client)).toBe(10)
        expect(SYSTEM_DB_MIGRATIONS.at(-1)).toMatchObject({ version: 10, id: 'run-handover' })
        closeSystemDb('v9h')
        expect(await columnsOf('v9h', 'runs')).toEqual(columns)
    })
})

describe('getSystemDb pooling', () => {
    it('shares one open between concurrent callers', async () => {
        const [a, b, c] = await Promise.all([getSystemDb('pooled'), getSystemDb('pooled'), getSystemDb('pooled')])
        expect(a).toBe(b)
        expect(b).toBe(c)
        expect(await getSystemDb('pooled')).toBe(a)
    })

    it('opens a fresh handle after close and keeps the data on disk', async () => {
        const first = await getSystemDb('reopen')
        await first.client.execute("INSERT INTO sessions (id, agent_id, created_at, updated_at) VALUES ('s', 'reopen', 'x', 'x')")
        closeSystemDb('reopen')

        const second = await getSystemDb('reopen')
        expect(second).not.toBe(first)
        const res = await second.client.execute('SELECT id FROM sessions')
        expect(res.rows.map(row => row.id)).toEqual(['s'])
    })

    it('ignores closing an agent that was never opened', () => {
        expect(() => closeSystemDb('never-opened')).not.toThrow()
    })

    it('swallows a close on a client that is already closed', async () => {
        const entry = await getSystemDb('double-close')
        entry.client.close()
        expect(() => closeSystemDb('double-close')).not.toThrow()
    })

    it('does not throw CLIENT_CLOSED when closeSystemDb races scheduleBackfillPaidSources or when one of two concurrent runs closes its toolset', async () => {
        const warnSpy = vi.spyOn(logger, 'warn')
        try {
            const seeded = await getSystemDb('race-backfill')
            await seeded.client.execute("DELETE FROM system_meta WHERE key = 'paid_backfill_done'")
            await seeded.client.execute(
                "INSERT INTO tool_calls (id, run_id, agent_id, session_id, step_number, tool_call_id, tool_name, input_json, result_json, is_error, created_at) VALUES ('tc1', 'r1', 'race-backfill', 's1', 1, 'call1', 'apollo_people_search', '{}', '{}', 0, '2026-01-01T00:00:00Z')",
            )
            await closeSystemDb('race-backfill')

            await getSystemDb('race-backfill')
            await closeSystemDb('race-backfill')
            for (let i = 0; i < 10; i++) {
                const { promise, resolve: done } = Promise.withResolvers<void>()
                setImmediate(done)
                await promise
            }
            const closedWarns = warnSpy.mock.calls.filter(call => JSON.stringify(call).includes('CLIENT_CLOSED') || JSON.stringify(call).includes('past paid data calls'))
            expect(closedWarns).toEqual([])

            const agent = {
                id: 'concurrent-db-agent',
                config: agentConfigSchema.parse({ name: 'cdb' }),
                soul: '',
                install: '',
                env: {},
                resolved: { provider: 'rerun' as const, model: 'rerun-max', connection: null },
            }
            const ctx = { agent, sessionId: 's1', logger, provider: 'rerun' as const, model: 'rerun-max', turnOrder: 'message-first' as const }
            const built1 = await buildTools(ctx as never)
            const built2 = await buildTools(ctx as never)
            const dbClient = await getAgentDb(agent.id)
            await dbClient.execute('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)')
            await built1.close()
            await expect(dbClient.execute('SELECT count(*) FROM items')).resolves.toBeDefined()
            await built2.close()
        } finally {
            warnSpy.mockRestore()
        }
    })
})

describe('systemDbExists', () => {
    it('is false until the first open creates the file', async () => {
        expect(systemDbExists('fresh')).toBe(false)
        await getSystemDb('fresh')
        expect(systemDbExists('fresh')).toBe(true)
    })
})
