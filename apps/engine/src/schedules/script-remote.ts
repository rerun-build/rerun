import { SCRIPT_DEFAULT_TIMEOUT_SEC, SCRIPT_TIMEOUT_EXIT_CODE, type RemoteComputerView, type RemoteJob, type ScheduleScript } from '@rerun/contracts'
import { listAgentIdsOnDisk } from '../agents/loader.js'
import type { LoadedAgent } from '../agents/types.js'
import { productName } from '../brand/brand.js'
import { getRun, SCRIPT_RUN_SESSION_ID } from '../db/repos/runs.js'
import { listOpenScriptJobs, recordRemoteJob } from '../db/repos/remote-jobs.js'
import { systemDbExists } from '../db/systemDb.js'
import { logger } from '../lib/logger.js'
import { refusedCommand } from '../remote/command-policy.js'
import { RemoteCallError, type RemoteConnection } from '../remote/connection.js'
import { jobContext, type JobContext } from '../remote/job-wake.js'
import { commandVerdict } from '../remote/policy.js'
import { listComputerViews, liveConnection } from '../remote/registry.js'
import { getComputer } from '../remote/store.js'
import { registerRunAbort, setRunCancel, unregisterRunAbort } from '../runtime/run-control.js'
import { findComputer } from '../tools/builtin/remote-common.js'
import { readSchedule } from './loader.js'
import { failure, keepTail, SCRIPT_OUTPUT_MAX_CHARS, settleAndAnnounce, timeoutLabel, type CommandResult } from './script-result.js'

// A script on a linked computer runs as a job: it outlives the engine's answer, may last up to an
// hour, and its end comes back as `job.finished`. Nobody is in a chat to say yes, so it runs only
// where the computer's owner already lets work through without anyone there.

type StopReason = 'limit' | 'cancel'

// A job the engine waits for, by run: stopped at its limit or when its run is cancelled. `settle`
// ends the run with what happened, for the routine that fired it or, after a restart, on its own.
type WatchedJob = { computerId: string; handle: string; jobId: string | null; timeoutSec: number; timer?: NodeJS.Timeout; stoppedBy: StopReason | null; settle: (result: CommandResult) => void }

const watched = new Map<string, WatchedJob>()

// How long a job has to tell its end once it was stopped. A computer that went offline meanwhile may
// never say it: the run fails then, so the routine fires again at its next time.
export const SCRIPT_STOP_GRACE_MS = 60_000

// Jobs that were stopped and whose end never came, by run: stopped again when their computer
// reconnects, and still read as stopped if their end comes after all.
const overdue = new Map<string, { computerId: string; jobId: string; timeoutSec: number; reason: StopReason }>()

const cancelledResult = (): CommandResult => ({ exitCode: null, output: '', timedOut: false, cancelled: true, error: 'Stopped' })

function settleWatched(runId: string, result: CommandResult): void {
    const job = watched.get(runId)
    if (!job) return
    watched.delete(runId)
    clearTimeout(job.timer)
    job.settle(result)
}

function stopJob(runId: string, reason: StopReason): void {
    const job = watched.get(runId)
    if (!job || job.stoppedBy) return
    job.stoppedBy = reason
    clearTimeout(job.timer)
    // Not started yet: it is stopped as soon as its computer says which job it is.
    if (!job.jobId) return
    const { jobId, computerId, handle, timeoutSec } = job
    overdue.set(runId, { computerId, jobId, timeoutSec, reason })
    const connection = liveConnection(computerId)
    // Whoever cancels does not wait a minute for a computer that is away: it is stopped when it comes back.
    if (!connection && reason === 'cancel') return settleWatched(runId, cancelledResult())
    void connection?.call('job.stop', { jobId }).catch(err => logger.warn({ jobId, err: String(err) }, 'script job could not be stopped'))
    job.timer = setTimeout(() => {
        logger.warn({ jobId, computerId }, 'script job did not end after it was stopped')
        settleWatched(runId, reason === 'cancel' ? cancelledResult() : failure(`#${handle} stopped answering: it went offline, or did not stop the command at its limit of ${timeoutLabel(timeoutSec)}.`))
    }, SCRIPT_STOP_GRACE_MS)
}

function armLimit(runId: string, remainingMs: number): void {
    const job = watched.get(runId)
    if (job) job.timer = setTimeout(() => stopJob(runId, 'limit'), Math.max(0, remainingMs))
}

export function stopOverdueScriptJobs(computerId: string, connection: RemoteConnection): void {
    for (const [runId, job] of overdue) {
        if (job.computerId !== computerId) continue
        void connection.call('job.stop', { jobId: job.jobId }).catch(err => logger.warn({ runId, jobId: job.jobId, err: String(err) }, 'overdue script job could not be stopped'))
    }
}

// A routine keeps its computer's id; an agent or an API client names it by its #handle, its name or that id.
export async function scriptComputer(ref: string): Promise<{ view: RemoteComputerView | null; known: RemoteComputerView[] }> {
    const { view, known } = await findComputer(ref)
    return { view: known.find(computer => computer.id === ref.trim()) ?? view, known }
}

// What the computer's owner has not let through without anyone in a chat, whether it is online or not.
export function computerSettingsRefusal(view: RemoteComputerView, command: string): string | null {
    const name = `#${view.handle}`
    if (!view.settings.unattended) return `${name} only takes work while someone is in a chat: its owner switched off work without anyone there.`
    const verdict = commandVerdict(view, command)
    if (verdict.allowed) return null
    if (verdict.analysis.opaque) return `${name} asks before running this command, since it hides what it runs (a substitution, a shell or a program named by its path). Write the program by its name, or give ${name} full access in its settings.`
    const programs = verdict.analysis.programs.join(', ')
    return `${name} asks before running ${programs || 'this command'}: allow ${programs ? 'it' : 'the program'} always in the settings of ${name}, or give it full access.`
}

// Why the computer cannot take the command now, said to whoever reads the run's output.
export function computerRefusal(view: RemoteComputerView, command: string): string | null {
    const name = `#${view.handle}`
    const refused = refusedCommand(command)
    if (refused) return `Not run on ${name}: ${refused}.`
    if (!view.online) return `${name} was offline: the ${productName()} app is not running on it, or it is asleep. Nothing was run.`
    if (view.paused) return `${name} is paused by its owner. Nothing was run.`
    const refusal = computerSettingsRefusal(view, command)
    return refusal ? `${refusal} Nothing was run.` : null
}

function callFailureText(view: RemoteComputerView, err: unknown): string {
    if (!(err instanceof RemoteCallError)) return err instanceof Error ? err.message : String(err)
    if (err.code === 'disconnected') return `#${view.handle} went offline before it started the command.`
    return `#${view.handle} refused or failed: ${err.message}`
}

export async function runOnComputer(agent: LoadedAgent, command: string, script: ScheduleScript, run: { runId: string; slug: string; name?: string; abort?: AbortSignal }): Promise<CommandResult> {
    const view = (await listComputerViews()).find(computer => computer.id === script.runsOn)
    if (!view) return failure('The computer this routine runs on is no longer linked to the workspace. Nothing was run.')
    const refusal = computerRefusal(view, command)
    if (refusal) return failure(refusal)
    const connection = liveConnection(view.id)
    if (!connection) return failure(computerRefusal({ ...view, online: false }, command) as string)
    if (!connection.offers('jobs')) return failure(`#${view.handle} does not run jobs: update ${productName()} on it. Nothing was run.`)
    if (run.abort?.aborted) return cancelledResult()

    return new Promise(resolve => {
        const job: WatchedJob = { computerId: view.id, handle: view.handle, jobId: null, timeoutSec: script.timeoutSec, stoppedBy: null, settle: resolve }
        watched.set(run.runId, job)
        run.abort?.addEventListener('abort', () => stopJob(run.runId, 'cancel'), { once: true })
        const context = jobContext({ agentId: agent.id, sessionId: SCRIPT_RUN_SESSION_ID, runId: run.runId }, view.id)
        connection
            .call('job.start', { command, cwd: script.folder.trim() || undefined, label: run.name ?? run.slug, context })
            .then(async ({ job: started }) => {
                await recordRemoteJob(agent.id, SCRIPT_RUN_SESSION_ID, view.id, started, run.runId).catch(() => {})
                // A job that already ended answered before its limit was set.
                if (watched.get(run.runId) !== job) return
                job.jobId = started.id
                const cancelledMeanwhile = job.stoppedBy
                if (!cancelledMeanwhile) return armLimit(run.runId, script.timeoutSec * 1000)
                job.stoppedBy = null
                stopJob(run.runId, cancelledMeanwhile)
            })
            .catch(err => settleWatched(run.runId, failure(callFailureText(view, err))))
    })
}

export function jobResult(job: RemoteJob, output: string, stoppedBy: StopReason | null, timeoutSec: number): CommandResult {
    const kept = keepTail(output)
    if (stoppedBy === 'limit' && job.state === 'stopped') return { exitCode: SCRIPT_TIMEOUT_EXIT_CODE, output: kept, timedOut: true, error: `Stopped after ${timeoutLabel(timeoutSec)}` }
    if (stoppedBy === 'cancel' && job.state === 'stopped') return { exitCode: job.exitCode, output: kept, timedOut: false, cancelled: true, error: 'Stopped' }
    if (job.state === 'succeeded') return { exitCode: job.exitCode ?? 0, output: kept, timedOut: false, error: null }
    if (job.state === 'lost') return { exitCode: job.exitCode, output: kept, timedOut: false, error: `The ${productName()} app on the computer quit or restarted while it ran` }
    if (job.state === 'stopped') return { exitCode: job.exitCode, output: kept, timedOut: false, error: 'Stopped on the computer' }
    return { exitCode: job.exitCode, output: kept, timedOut: false, error: job.exitCode !== null ? `Exit code ${job.exitCode}` : 'Failed' }
}

// The end of a script's job. Whoever waits for it settles its run; when nobody does any more (it was
// given up on after it was stopped), the run is settled here with what really happened.
export async function settleScriptJob(context: JobContext & { runId: string }, job: RemoteJob, connection: RemoteConnection): Promise<void> {
    const output = await connection
        .call('job.logs', { jobId: job.id, tailBytes: SCRIPT_OUTPUT_MAX_CHARS }, { timeoutMs: 10_000 })
        .then(logs => logs.output)
        .catch(() => '')
    const late = overdue.get(context.runId)
    overdue.delete(context.runId)
    const waiting = watched.get(context.runId)
    if (waiting) return settleWatched(context.runId, jobResult(job, output, waiting.stoppedBy, waiting.timeoutSec))
    const run = await getRun(context.agentId, context.runId)
    if (!run?.triggerSlug || run.exitCode !== null) return
    // Read again for its name and whom it tells: the routine that started the job is not in memory any more.
    const schedule = await readSchedule(context.agentId, run.triggerSlug).catch(() => null)
    const result = jobResult(job, output, late?.reason ?? null, late?.timeoutSec ?? schedule?.script?.timeoutSec ?? 0)
    await settleAndAnnounce(context.agentId, context.runId, { slug: run.triggerSlug, name: schedule?.name ?? job.label ?? run.triggerSlug, script: schedule?.script ?? null }, result)
}

// After a restart of the engine, the jobs still out on their computers: their run was left running
// (`failInterruptedRuns`), and here it is live again, with what is left of its limit counted from
// when it started. One whose computer never comes back fails a minute after that limit.
export async function resumeScriptJobs(now = Date.now()): Promise<number> {
    let resumed = 0
    for (const agentId of await listAgentIdsOnDisk()) {
        if (!systemDbExists(agentId)) continue
        for (const open of await listOpenScriptJobs(agentId)) {
            const run = await getRun(agentId, open.runId)
            const slug = run?.triggerSlug
            if (!run || !slug || run.status !== 'running') continue
            const schedule = await readSchedule(agentId, slug).catch(() => null)
            const timeoutSec = schedule?.script?.timeoutSec ?? SCRIPT_DEFAULT_TIMEOUT_SEC
            const handle = (await getComputer(open.computerId))?.handle ?? 'computer'
            const { signal } = registerRunAbort(run.id, agentId, { script: true })
            const settled = new Promise<CommandResult>(settle => watched.set(run.id, { computerId: open.computerId, handle, jobId: open.id, timeoutSec, stoppedBy: null, settle }))
                .then(result => settleAndAnnounce(agentId, run.id, { slug, name: schedule?.name ?? open.label ?? slug, script: schedule?.script ?? null }, result))
                .catch(err => logger.error({ agent: agentId, runId: run.id, err: String(err) }, 'resumed script job could not be settled'))
                .finally(() => unregisterRunAbort(run.id))
            setRunCancel(run.id, () => settled)
            signal.addEventListener('abort', () => stopJob(run.id, 'cancel'), { once: true })
            armLimit(run.id, Date.parse(run.startedAt) + timeoutSec * 1000 - now)
            resumed++
        }
    }
    if (resumed > 0) logger.info({ jobs: resumed }, 'script jobs resumed after a restart')
    return resumed
}
