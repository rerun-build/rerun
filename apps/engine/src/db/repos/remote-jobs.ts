import type { RemoteJob } from '@rerun/contracts'
import { getSystemDb } from '../systemDb.js'

export type RemoteJobRow = { id: string; computerId: string; sessionId: string; command: string; label: string | null; author: string | null; state: string; exitCode: number | null; startedAt: string; endedAt: string | null; wokeAt: string | null; runId: string | null }

const rowOf = (row: Record<string, unknown>): RemoteJobRow => ({
    id: String(row.id),
    computerId: String(row.computer_id),
    sessionId: String(row.session_id),
    command: String(row.command),
    label: (row.label as string | null) ?? null,
    author: (row.author as string | null) ?? null,
    state: String(row.state),
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    startedAt: String(row.started_at),
    endedAt: (row.ended_at as string | null) ?? null,
    wokeAt: (row.woke_at as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
})

// `runId`: the run of a script routine the job is, which has no conversation to be found by.
export async function recordRemoteJob(agentId: string, sessionId: string, computerId: string, job: RemoteJob, runId: string | null = null): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await client.execute({
        sql: 'INSERT OR IGNORE INTO remote_jobs (id, computer_id, session_id, command, label, author, state, exit_code, started_at, ended_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [job.id, computerId, sessionId, job.command, job.label ?? null, job.author ?? null, job.state, job.exitCode, job.startedAt, job.endedAt, runId],
    })
}

// The jobs of script routines whose end was never told: still out on their computer.
export async function listOpenScriptJobs(agentId: string): Promise<Array<RemoteJobRow & { runId: string }>> {
    const { client } = await getSystemDb(agentId)
    const result = await client.execute('SELECT * FROM remote_jobs WHERE run_id IS NOT NULL AND ended_at IS NULL')
    return result.rows.map(row => rowOf(row as unknown as Record<string, unknown>)).flatMap(job => (job.runId ? [{ ...job, runId: job.runId }] : []))
}

export async function getRemoteJob(agentId: string, jobId: string): Promise<RemoteJobRow | null> {
    const { client } = await getSystemDb(agentId)
    const result = await client.execute({ sql: 'SELECT * FROM remote_jobs WHERE id = ?', args: [jobId] })
    return result.rows[0] ? rowOf(result.rows[0] as unknown as Record<string, unknown>) : null
}

export async function listRemoteJobs(agentId: string, sessionId?: string): Promise<RemoteJobRow[]> {
    const { client } = await getSystemDb(agentId)
    const result = sessionId ? await client.execute({ sql: 'SELECT * FROM remote_jobs WHERE session_id = ? ORDER BY started_at DESC', args: [sessionId] }) : await client.execute('SELECT * FROM remote_jobs ORDER BY started_at DESC LIMIT 200')
    return result.rows.map(row => rowOf(row as unknown as Record<string, unknown>))
}

export async function settleRemoteJob(agentId: string, job: RemoteJob): Promise<void> {
    const { client } = await getSystemDb(agentId)
    await client.execute({ sql: 'UPDATE remote_jobs SET state = ?, exit_code = ?, ended_at = ? WHERE id = ?', args: [job.state, job.exitCode, job.endedAt, job.id] })
}

// True for the one caller that gets to wake the conversation: the end of a job is told again until
// heard, and only the first telling wakes.
export async function claimRemoteJobWake(agentId: string, jobId: string, at: string): Promise<boolean> {
    const { client } = await getSystemDb(agentId)
    const result = await client.execute({ sql: 'UPDATE remote_jobs SET woke_at = ? WHERE id = ? AND woke_at IS NULL', args: [at, jobId] })
    return result.rowsAffected === 1
}
