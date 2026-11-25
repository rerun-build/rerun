import type { ModelMessage } from 'ai'
import { buildJobEndMessage, type RemoteJob } from '@rerun/contracts'
import { agentExists } from '../agents/loader.js'
import { env } from '../config/env.js'
import { signatureOf, signedWith } from '../lib/signed-ticket.js'
import { getAgent } from '../agents/registry.js'
import { listMessages } from '../db/repos/messages.js'
import { claimRemoteJobWake, getRemoteJob, recordRemoteJob, settleRemoteJob } from '../db/repos/remote-jobs.js'
import { logger } from '../lib/logger.js'
import { startHeadlessRun } from '../runtime/headless-run.js'
import { sessionClaim } from '../runtime/run-control.js'
import { findPendingHitl } from '../tools/builtin/hitl.js'
import type { RemoteConnection } from './connection.js'
import { liveConnection, onRemoteEvent } from './registry.js'
import { getComputer } from './store.js'
import { productText } from '../brand/brand.js'

// The end of a job a coworker started on a computer wakes that coworker in the conversation it
// started it from, once, with what came out of it. The wake waits for the conversation to be free:
// a run in flight finishes first, and a card waiting for the person is answered first, since a
// message landing under it would read as their answer. The computer is told the end was heard only
// once the wake is delivered: until then it tells it again, at each connection too, so an engine
// that restarts while it waits picks the end up where it left it.

export type JobContext = { agentId: string; sessionId: string }

const signedPart = (computerId: string, context: JobContext) => `${computerId}\n${context.agentId}\n${context.sessionId}`

// Signed with the box key for the one computer it is handed to: a computer cannot name a
// conversation the engine never started a job from on it. A box without a key signs nothing, like
// its tickets (`lib/signed-ticket.ts`).
export function jobContext(context: JobContext, computerId: string, key: string | undefined = env().RERUN_API_KEY): string {
    return JSON.stringify({ a: context.agentId, s: context.sessionId, ...(key ? { m: signatureOf(key, signedPart(computerId, context)) } : {}) })
}

export function readJobContext(raw: string | undefined, computerId: string, key: string | undefined = env().RERUN_API_KEY): JobContext | null {
    try {
        const parsed = JSON.parse(raw ?? '') as { a?: unknown; s?: unknown; m?: unknown }
        if (typeof parsed.a !== 'string' || typeof parsed.s !== 'string') return null
        const context = { agentId: parsed.a, sessionId: parsed.s }
        if (key && !signedWith(key, signedPart(computerId, context), typeof parsed.m === 'string' ? parsed.m : undefined)) return null
        return context
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

// Wrapped as a job end, so the chat draws a divider rather than a message the user seems to have typed.
export function wakeMessage(handle: string, job: RemoteJob, tail: string): string {
    const exit = job.exitCode !== null ? ` (exit ${job.exitCode})` : ''
    const report = [
        `The job ${job.id} you started on #${handle} has ended: it ${productText(OUTCOME[job.state])}${exit}${duration(job)}.`,
        `Command: ${job.command}`,
        tail.trim() ? `Last lines of its output:\n${tail.trim()}` : 'It printed nothing.',
        'Carry on with the task it was for, and tell the user what came out of it.',
    ].join('\n\n')
    return buildJobEndMessage({ computer: handle, jobId: job.id, state: job.state, label: job.label ?? null, report })
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
    // Once, across restarts too: the end may be told again after a wake that was already delivered.
    if (!(await claimRemoteJobWake(context.agentId, trigger.jobId, new Date().toISOString()))) return
    const agent = await getAgent(context.agentId)
    await (deps.start ?? startHeadlessRun)(agent, context.sessionId, message, undefined, { source: 'job', ...trigger })
}

// The ends being delivered: the computer tells each one again every half minute meanwhile.
const delivering = new Set<string>()

export async function handleJobFinished(computerId: string, job: RemoteJob, connection: RemoteConnection, deps: WakeDeps = {}): Promise<void> {
    const context = readJobContext(job.context, computerId)
    if (!context || !agentExists(context.agentId)) {
        connection.acknowledgeJob(job.id)
        return
    }
    const key = `${context.agentId}:${job.id}`
    if (delivering.has(key)) return
    delivering.add(key)
    try {
        const known = await getRemoteJob(context.agentId, job.id)
        if (!known) await recordRemoteJob(context.agentId, context.sessionId, computerId, job)
        await settleRemoteJob(context.agentId, job)
        if (!known?.wokeAt) {
            const tail = await connection
                .call('job.logs', { jobId: job.id, tailBytes: TAIL_BYTES }, { timeoutMs: 10_000 })
                .then(logs => logs.output)
                .catch(() => '')
            const handle = (await getComputer(computerId))?.handle ?? 'computer'
            await wakeWhenFree(context, wakeMessage(handle, job, tail), { computer: handle, jobId: job.id }, deps)
        }
    } finally {
        delivering.delete(key)
    }
    // The socket may have been replaced while the conversation was busy.
    ;(liveConnection(computerId) ?? connection).acknowledgeJob(job.id)
}

export function startJobWakes(deps: WakeDeps = {}): () => void {
    return onRemoteEvent((computerId, event, connection) => {
        if (event.event !== 'job.finished') return
        handleJobFinished(computerId, event.job, connection, deps).catch(err => logger.warn({ err: String(err), computerId, jobId: event.job.id }, 'job end not handled'))
    })
}
