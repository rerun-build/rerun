import { FOREMAN_AGENT_ID, runStatusSchema, type RunStarterKind, type UsageRun } from '@rerun/contracts'
import { getSystemDb, systemDbExists } from '../systemDb.js'
import { listMembers } from './members.js'

export type UsageRunsWindow = { from: string; to: string; since?: string; limit: number }

type Row = {
    id: string
    agent_id: string
    status: string
    started_at: string
    finished_at: string | null
    provider: string | null
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    cost_micros: number | null
    starter_kind: string | null
    starter_id: string | null
    trigger_source: string | null
    trigger_slug: string | null
    session_source: string | null
    origin_agent_id: string | null
}

const TRIGGER_STARTER: Record<string, RunStarterKind> = { schedule: 'schedule', trigger: 'webhook', checkin: 'checkin', job: 'job' }

// A run from before system.db v9 has no starter of its own. Its trigger says it for a schedule, a
// webhook, a check-in or a job, and its session for a call from another coworker. A chat says
// nothing about the person who wrote it: that run stays not recorded, never guessed.
export function recordedStarter(row: Pick<Row, 'starter_kind' | 'starter_id' | 'trigger_source' | 'trigger_slug' | 'session_source' | 'origin_agent_id'>): { kind: RunStarterKind | null; id: string | null } {
    if (row.starter_kind) return { kind: row.starter_kind as RunStarterKind, id: row.starter_id }
    const fromTrigger = row.trigger_source ? TRIGGER_STARTER[row.trigger_source] : undefined
    if (fromTrigger) return { kind: fromTrigger, id: row.trigger_slug }
    if (row.session_source === 'agent' && row.origin_agent_id) return { kind: 'coworker', id: row.origin_agent_id }
    return { kind: null, id: null }
}

async function agentRuns(agentId: string, query: UsageRunsWindow): Promise<Row[]> {
    const { client } = await getSystemDb(agentId)
    const window = `((r.started_at >= ? AND r.started_at <= ?) OR r.status = 'running')`
    // A run that ended after `since` comes back even when it started before the window: the
    // dashboard saw it running, and would otherwise keep it running forever.
    const where = query.since ? `(${window} AND (r.started_at >= ? OR r.status = 'running')) OR r.finished_at >= ?` : window
    const result = await client.execute({
        sql: `SELECT r.id, r.agent_id, r.status, r.started_at, r.finished_at, r.provider, r.model, r.input_tokens, r.output_tokens,
                     r.cost_micros, r.starter_kind, r.starter_id, r.trigger_source, r.trigger_slug,
                     s.source AS session_source, s.origin_agent_id
              FROM runs r LEFT JOIN sessions s ON s.id = r.session_id
              WHERE ${where}
              ORDER BY r.started_at DESC
              LIMIT ?`,
        args: [query.from, query.to, ...(query.since ? [query.since, query.since] : []), query.limit + 1],
    })
    return result.rows as unknown as Row[]
}

async function memberNames(): Promise<Map<string, string>> {
    if (!systemDbExists(FOREMAN_AGENT_ID)) return new Map()
    const members = await listMembers()
    return new Map(members.flatMap(member => (member.name ? [[member.id, member.name] as const] : [])))
}

// Every run of every coworker of the machine in a window, newest first, for the usage dashboard.
// `since` keeps only the runs that started or ended after it, plus the ones still running, so the
// dashboard can refresh live without reading the whole window again.
export async function listUsageRuns(agentIds: string[], query: UsageRunsWindow): Promise<{ runs: UsageRun[]; truncated: boolean }> {
    const withRuns = agentIds.filter(systemDbExists)
    const [perAgent, names] = await Promise.all([Promise.all(withRuns.map(agentId => agentRuns(agentId, query))), memberNames()])
    const rows = perAgent.flat().sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
    const truncated = rows.length > query.limit
    const runs = rows.slice(0, query.limit).map((row): UsageRun => {
        const starter = recordedStarter(row)
        const status = runStatusSchema.safeParse(row.status)
        return {
            id: row.id,
            agentId: row.agent_id,
            status: status.success ? status.data : 'error',
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            provider: row.provider,
            model: row.model,
            inputTokens: Number(row.input_tokens ?? 0),
            outputTokens: Number(row.output_tokens ?? 0),
            costMicros: row.cost_micros === null ? null : Number(row.cost_micros),
            starterKind: starter.kind,
            starterId: starter.id,
            starterName: starter.kind === 'person' && starter.id ? (names.get(starter.id) ?? null) : null,
        }
    })
    return { runs, truncated }
}
