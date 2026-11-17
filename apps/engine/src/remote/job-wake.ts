import type { ModelMessage } from 'ai'
import type { RemoteJob } from '@rerun/contracts'
import { agentExists } from '../agents/loader.js'
import { getAgent } from '../agents/registry.js'
import { listMessages } from '../db/repos/messages.js'
import { claimRemoteJobWake, getRemoteJob, recordRemoteJob, settleRemoteJob } from '../db/repos/remote-jobs.js'
import { logger } from '../lib/logger.js'
import { startHeadlessRun } from '../runtime/headless-run.js'
import { sessionClaim } from '../runtime/run-control.js'
import { findPendingHitl } from '../tools/builtin/hitl.js'
import type { RemoteConnection } from './connection.js'
import { onRemoteEvent } from './registry.js'
import { getComputer } from './store.js'

// The end of a job a coworker started on a computer wakes that coworker in the conversation it
// started it from, once, with what came out of it. The wake waits for the conversation to be free:
// a run in flight finishes first, and a card waiting for the person is answered first, since a
// message landing under it would read as their answer.

export type JobContext = { agentId: string; sessionId: string }

export const jobContext = (context: JobContext): string => JSON.stringify({ a: context.agentId, s: context.sessionId })

export function readJobContext(raw: string | undefined): JobContext | null {
    try {
        const parsed = JSON.parse(raw ?? '') as { a?: unknown; s?: unknown }
        return typeof parsed.a === 'string' && typeof parsed.s === 'string' ? { agentId: parsed.a, sessionId: parsed.s } : null
    } catch {
        return null
    }
}

const POLL_MS = 3_000
// A conversation that stays busy this long is not waited on any more: the job's end stays readable
// with remote_job.
const GIVE_UP_MS = 12 * 60 * 60 * 1000
const TAIL_BYTES = 3_000

function duration(job: RemoteJob): string {
    if (!job.endedAt) return ''
    const minutes = Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 60_000)
    if (minutes < 1) return ' after less than a minute'
    return minutes < 120 ? ` after ${minutes} min` : ` after ${(minutes / 60).toFixed(1)} h`
}

const OUTCOME: Record<RemoteJob['state'], string> = {
    running: 'is still running',
    succeeded: 'succeeded',
    failed: 'failed',
    stopped: 'was stopped',
    lost: 'was lost (the Rerun app on the computer quit or restarted while it ran)',
}

export function wakeMessage(handle: string, job: RemoteJob, tail: string): string {
    const exit = job.exitCode !== null ? ` (exit ${job.exitCode})` : ''
    return [
        `[The job ${job.id} you started on #${handle} has ended: it ${OUTCOME[job.state]}${exit}${duration(job)}.]`,
        `Command: ${job.command}`,
        tail.trim() ? `Last lines of its output:\n${tail.trim()}` : 'It printed nothing.',
        'Carry on with the task it was for, and tell the user what came out of it.',
    ].join('\n\n')
}

async function conversationBusy(agentId: string, sessionId: string): Promise<boolean> {
    if (sessionClaim(sessionId)) return true
    const stored = await listMessages(agentId, sessionId)
    const messages = stored.map(message => ({ role: message.role, content: JSON.parse(message.contentJson) })) as ModelMessage[]
    return findPendingHitl(messages) !== null
}

export type WakeDeps = { pollMs?: number; giveUpMs?: number; start?: typeof startHeadlessRun }

async function wakeWhenFree(context: JobContext, message: string, trigger: { computer: string; jobId: string }, deps: WakeDeps): Promise<void> {
    const deadline = Date.now() + (deps.giveUpMs ?? GIVE_UP_MS)
    while (await conversationBusy(context.agentId, context.sessionId)) {
        if (Date.now() > deadline) return logger.warn({ ...context, jobId: trigger.jobId }, 'job end not delivered: the conversation stayed busy')
        await new Promise(resolve => setTimeout(resolve, deps.pollMs ?? POLL_MS))
    }
    if (!agentExists(context.agentId)) return
    const agent = await getAgent(context.agentId)
    await (deps.start ?? startHeadlessRun)(agent, context.sessionId, message, undefined, { source: 'job', ...trigger })
}

export async function handleJobFinished(computerId: string, job: RemoteJob, connection: RemoteConnection, deps: WakeDeps = {}): Promise<void> {
    const context = readJobContext(job.context)
    if (!context || !agentExists(context.agentId)) {
        connection.acknowledgeJob(job.id)
        return
    }
    if (!(await getRemoteJob(context.agentId, job.id))) await recordRemoteJob(context.agentId, context.sessionId, computerId, job)
    await settleRemoteJob(context.agentId, job)
    // Heard once it is on record: an engine that dies before this hears it again at the next connection.
    connection.acknowledgeJob(job.id)
    if (!(await claimRemoteJobWake(context.agentId, job.id, new Date().toISOString()))) return
    const tail = await connection
        .call('job.logs', { jobId: job.id, tailBytes: TAIL_BYTES }, { timeoutMs: 10_000 })
        .then(logs => logs.output)
        .catch(() => '')
    const handle = (await getComputer(computerId))?.handle ?? 'computer'
    await wakeWhenFree(context, wakeMessage(handle, job, tail), { computer: handle, jobId: job.id }, deps)
}

export function startJobWakes(deps: WakeDeps = {}): () => void {
    return onRemoteEvent((computerId, event, connection) => {
        if (event.event !== 'job.finished') return
        handleJobFinished(computerId, event.job, connection, deps).catch(err => logger.warn({ err: String(err), computerId, jobId: event.job.id }, 'job end not handled'))
    })
}
