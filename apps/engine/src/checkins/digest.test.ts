import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-digest-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { beforeAll, describe, expect, it } = await import('vitest')
const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { createAgent } = await import('../agents/factory.js')
const { getSystemDb } = await import('../db/systemDb.js')
const { raw } = await import('../db/client.js')
const { touchMember } = await import('../db/repos/members.js')
const { createSession } = await import('../db/repos/sessions.js')
const { appendMessage } = await import('../db/repos/messages.js')
const { writeSchedule } = await import('../schedules/loader.js')
const { buildDigest } = await import('./digest.js')

const now = Date.parse('2026-11-19T09:00:00.000Z')
const DAY = 24 * 60 * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

async function run(agentId: string, status: string, startedAt: number) {
    const { client } = await getSystemDb(agentId)
    await client.execute({ sql: 'INSERT INTO runs (id, agent_id, session_id, status, started_at) VALUES (?, ?, ?, ?, ?)', args: [`${agentId}-${startedAt}-${status}`, agentId, 's', status, iso(startedAt)] })
}

let invoices = ''
let seo = ''

beforeAll(async () => {
    await migrate()
    await ensureForeman()
    invoices = (await createAgent({ config: { name: 'Invoices' } })).id
    seo = (await createAgent({ config: { name: 'SEO watcher' } })).id
    await raw().execute({ sql: 'UPDATE agents SET created_at = ?', args: [iso(now - 40 * DAY)] })
    for (const hours of [1, 2, 3]) await run(invoices, 'error', now - hours * 3_600_000)
    await run(invoices, 'done', now - 2 * DAY)
    await run(seo, 'done', now - 20 * DAY)
    const session = await createSession(invoices, 'Chasing', undefined, 'dashboard')
    await appendMessage(invoices, session.id, { role: 'assistant', content: [{ type: 'text', text: 'Which customer first?' }, { type: 'tool-call', toolCallId: 'q1', toolName: 'ask_user', input: { question: 'Which one?' } }] } as never)
    const { client: system } = await getSystemDb(invoices)
    await system.execute({ sql: 'UPDATE sessions SET updated_at = ? WHERE id = ?', args: [iso(now - DAY), session.id] })
    await system.execute({ sql: "INSERT INTO skill_proposals (id, agent_id, session_id, tool_call_id, mode, title, summary, instructions_json, fingerprints_json, status, created_at) VALUES ('p1', ?, 's', 't1', 'create', 'Chase', 'How to chase', '[]', '[]', 'proposed', ?)", args: [invoices, iso(now)] })
    await writeSchedule(seo, { name: 'Weekly ranks', body: 'Check the ranks.', cron: '0 8 * * 1' })
    const { client: foreman } = await getSystemDb(FOREMAN_AGENT_ID)
    await foreman.execute({ sql: "INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES ('f1', 'foreman', 'General', ?, ?)", args: [iso(now - 30 * DAY), iso(now - 30 * DAY)] })
    await foreman.execute({ sql: "INSERT INTO runs (id, agent_id, session_id, status, started_at, trigger_source) VALUES ('c1', 'foreman', 'f1', 'done', ?, 'checkin')", args: [iso(now - 3 * DAY)] })
    await touchMember({ id: 'u1', name: 'Ana', timezone: 'Europe/Paris' }, iso(now - 2 * DAY))
})

describe('buildDigest', () => {
    it('reads what the box holds, in numbers and short labels', async () => {
        const digest = await buildDigest(now)
        expect(digest).toMatchObject({
            workspaceAgeDays: 30,
            daysSinceLastCheckin: 3,
            daysSinceLastHumanMessage: 2,
            coworkers: 2,
            failedRuns24h: 3,
            failingCoworkers: ['Invoices'],
            pendingQuestions: 1,
            appsNeedingSignIn: 0,
            inactiveCoworkers: ['SEO watcher'],
            openSkillProposals: 1,
        })
        expect(digest.neverUsed).toEqual(expect.arrayContaining(['webhook_triggers', 'company_brain', 'shared_database']))
        expect(digest.neverUsed).not.toContain('scheduled_tasks')
    })
})
