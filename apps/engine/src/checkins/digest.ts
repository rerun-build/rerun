import { FOREMAN_AGENT_ID, type CheckinDigest } from '@rerun/contracts'
import type { ModelMessage } from 'ai'
import { listAgentIndex } from '../db/repos/agents.js'
import { listMembers } from '../db/repos/members.js'
import { getSharedDb, SHARED_HIDDEN_TABLES } from '../db/sharedDb.js'
import { listTables } from '../db/sqlStore.js'
import { getSystemDb } from '../db/systemDb.js'
import { listPageFiles } from '../brain/pages.js'
import { listSchedules } from '../schedules/loader.js'
import { listTriggers } from '../triggers/loader.js'
import { findPendingHitl } from '../tools/builtin/hitl.js'
import { listVaultItems } from '../vault/store.js'
import { logger } from '../lib/logger.js'

const DAY_MS = 24 * 60 * 60_000
// A coworker that has not run for this long, though it has been around for longer, sits idle.
const INACTIVE_AFTER_DAYS = 14
// A question older than this was answered elsewhere or forgotten for good: it says nothing new.
const PENDING_WINDOW_DAYS = 7
const LABELS_MAX = 20

const daysBetween = (from: string | null | undefined, now: number): number | null => (from ? Math.max(0, Math.floor((now - Date.parse(from)) / DAY_MS)) : null)

type CoworkerState = { name: string; failedRuns24h: number; pendingQuestions: number; openSkillProposals: number; lastRunAt: string | null; createdAt: string }

async function coworkerState(agent: { id: string; name: string; createdAt: string }, now: number): Promise<CoworkerState> {
    const { client } = await getSystemDb(agent.id)
    const dayAgo = new Date(now - DAY_MS).toISOString()
    const [failed, lastRun, proposals, sessions] = await Promise.all([
        client.execute({ sql: "SELECT count(*) AS n FROM runs WHERE status = 'error' AND started_at >= ?", args: [dayAgo] }),
        client.execute('SELECT max(started_at) AS at FROM runs'),
        client.execute("SELECT count(*) AS n FROM skill_proposals WHERE status = 'proposed'"),
        client.execute({
            sql: 'SELECT m.role, m.content_json FROM sessions s JOIN messages m ON m.id = (SELECT id FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) WHERE s.updated_at >= ?',
            args: [new Date(now - PENDING_WINDOW_DAYS * DAY_MS).toISOString()],
        }),
    ])
    const pendingQuestions = sessions.rows.filter(row => {
        try {
            return findPendingHitl([{ role: String(row.role), content: JSON.parse(String(row.content_json)) } as ModelMessage]) !== null
        } catch {
            return false
        }
    }).length
    return { name: agent.name, failedRuns24h: Number(failed.rows[0]?.n ?? 0), pendingQuestions, openSkillProposals: Number(proposals.rows[0]?.n ?? 0), lastRunAt: (lastRun.rows[0]?.at as string | null) ?? null, createdAt: agent.createdAt }
}

async function neverUsed(agentIds: string[]): Promise<CheckinDigest['neverUsed']> {
    const [schedules, triggers, pages, tables] = await Promise.all([
        Promise.all(agentIds.map(id => listSchedules(id).catch(() => []))),
        Promise.all(agentIds.map(id => listTriggers(id).catch(() => []))),
        listPageFiles().catch(() => []),
        getSharedDb()
            .then(client => listTables(client, SHARED_HIDDEN_TABLES))
            .catch(() => []),
    ])
    const unused: CheckinDigest['neverUsed'] = []
    if (schedules.every(list => list.length === 0)) unused.push('scheduled_tasks')
    if (triggers.every(list => list.length === 0)) unused.push('webhook_triggers')
    if (pages.length === 0) unused.push('company_brain')
    if (tables.length === 0) unused.push('shared_database')
    return unused
}

// The foreman's own history: how old the workspace is (its first conversation with the Chief of
// Staff), when it last checked in, and when a person last wrote anywhere on the box.
async function foremanHistory(now: number) {
    const { client } = await getSystemDb(FOREMAN_AGENT_ID)
    const [first, last, members] = await Promise.all([client.execute('SELECT min(created_at) AS at FROM sessions'), client.execute("SELECT max(started_at) AS at FROM runs WHERE trigger_source = 'checkin'"), listMembers()])
    return {
        workspaceAgeDays: daysBetween(first.rows[0]?.at as string | null, now) ?? 0,
        daysSinceLastCheckin: daysBetween(last.rows[0]?.at as string | null, now),
        daysSinceLastHumanMessage: daysBetween(members[0]?.lastSeenAt, now),
    }
}

// What the pulse looks at, read from the box alone. A coworker whose files cannot be read is left
// out rather than failing the pulse.
export async function buildDigest(now = Date.now()): Promise<CheckinDigest> {
    const coworkers = (await listAgentIndex()).filter(agent => agent.id !== FOREMAN_AGENT_ID)
    const states = (await Promise.all(coworkers.map(agent => coworkerState(agent, now).catch(err => (logger.warn({ err: String(err), agent: agent.id }, 'pulse could not read a coworker'), null))))).filter((state): state is CoworkerState => state !== null)
    const [history, unused, vault] = await Promise.all([foremanHistory(now), neverUsed(coworkers.map(agent => agent.id)), listVaultItems().catch(() => [])])
    const idle = (state: CoworkerState) => (daysBetween(state.createdAt, now) ?? 0) >= INACTIVE_AFTER_DAYS && (daysBetween(state.lastRunAt, now) ?? Infinity) >= INACTIVE_AFTER_DAYS
    return {
        ...history,
        coworkers: coworkers.length,
        failedRuns24h: states.reduce((sum, state) => sum + state.failedRuns24h, 0),
        failingCoworkers: states.filter(state => state.failedRuns24h > 0).map(state => state.name.slice(0, 60)).slice(0, LABELS_MAX),
        pendingQuestions: states.reduce((sum, state) => sum + state.pendingQuestions, 0),
        appsNeedingSignIn: vault.filter(item => item.config.status === 'needs_auth').length,
        inactiveCoworkers: states.filter(idle).map(state => state.name.slice(0, 60)).slice(0, LABELS_MAX),
        openSkillProposals: states.reduce((sum, state) => sum + state.openSkillProposals, 0),
        neverUsed: unused,
    }
}
