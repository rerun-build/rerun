import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { automationModel } from '../agents/availability.js'
import { pickBackup } from '../agents/backups.js'
import { listAgentIdsOnDisk } from '../agents/loader.js'
import { getAgent } from '../agents/registry.js'
import { createSession } from '../db/repos/sessions.js'
import { deleteFiredOneOff, listSchedules, markFired, type Schedule } from '../schedules/loader.js'
import { buildScheduledRunMessage } from '../schedules/message.js'
import { isDue } from '../schedules/cron.js'
import { sweepMemoriesIfDue } from '../memory/maintenance.js'
import { maintainBrainIfDue } from '../brain/maintenance.js'
import { sweepCodexHomesIfDue } from '../connections/codex-sweep.js'
import { isPlanLimitLatched } from '../connections/plan-limits.js'
import { offersComputer } from '../tools/builtin/computer.js'
import { startHeadlessRun } from './headless-run.js'
import { sendNotification } from './notify.js'
import { isBudgetLatched } from './budget-latch.js'
import { agentHasLiveRun } from './run-control.js'
import { nowIso } from '../lib/ids.js'
import { PROMISE_DAILY_CAP, promisesInLastDay, startCheckin } from '../checkins/run.js'
import { announcePendingCheckins } from '../checkins/settle.js'
import { agentDisabled, budgetExhausted, coworkerBusy, HttpError, promiseCapReached, subscriptionLimited } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

const TICK_MS = 30_000

const inFlight = new Map<string, { runId: string; sessionId: string }>()

export async function fireSchedule(agentId: string, schedule: Schedule, opts?: { markFired?: boolean; manual?: boolean }): Promise<{ runId: string; sessionId: string }> {
    const key = `${agentId}/${schedule.slug}`
    const existing = inFlight.get(key)
    if (existing) return existing

    const agent = await getAgent(agentId)
    if (!agent.config.enabled) throw agentDisabled()
    if (agent.config.kind === 'foreman' && schedule.checkIn) return firePromise(schedule, opts)
    // A coworker has one screen, taken by the first of its runs to act on it, which may come well
    // after that run started. A schedule firing beside a live run (a chat, a call from another
    // coworker) would race it for the screen, so it stays due and fires on the tick after that run.
    if (!opts?.manual && agentHasLiveRun(agentId) && offersComputer(agent.config)) throw coworkerBusy()
    // Resolved before markFired so a budget skip leaves the schedule due: it resumes on the first
    // tick after the latch clears, with no session, no run and no notification in the meantime.
    // Only the managed provider burns the workspace budget, so an agent on its own key still fires.
    const override = await automationModel(agent, schedule, 'schedule')
    if (!opts?.manual && override.provider === 'rerun' && isBudgetLatched()) throw budgetExhausted()
    // A subscription that ran out still lets the schedule fire when a backup is free: the run goes
    // there on its own. With none, it stays due until the reset.
    if (!opts?.manual && override.connectionId && isPlanLimitLatched(override.connectionId) && !(await pickBackup(new Set([override.connectionId])))) throw subscriptionLimited()
    // Stamped before the launch, not after: a schedule whose run preparation keeps throwing would
    // otherwise stay due forever and re-fire on every 30s tick. The trade-off is at-most-once — a
    // crash mid-run costs that occurrence instead of replaying work that may already be done.
    const stamped = opts?.markFired !== false
    const firedAt = nowIso()
    if (stamped) await markFired(agentId, schedule.slug, firedAt)
    const session = await createSession(agentId, `schedule: ${schedule.slug}`, undefined, 'schedule')
    await sendNotification({
        event: 'agent.session.created',
        kind: 'info',
        agentId,
        sessionId: session.id,
        runId: null,
        message: `Scheduled run: ${schedule.name}`,
        title: schedule.name,
        source: 'schedule',
    })
    const { runId, settled } = await startHeadlessRun(agent, session.id, buildScheduledRunMessage(schedule), override, { source: 'schedule', slug: schedule.slug, name: schedule.name })

    const started = { runId, sessionId: session.id }
    inFlight.set(key, started)
    logger.info({ agent: agentId, schedule: schedule.slug, runId, session: session.id }, 'scheduled run fired')

    // `settled` always resolves; `result.finishReason` does not when a provider stream hangs, and
    // an entry left in `inFlight` freezes this schedule for the lifetime of the process.
    // A one-off that did its job leaves the list. One that failed, was cancelled or stopped on a
    // question stays, switched off, so its outcome is still there to read and run again.
    void settled
        .then(async outcome => {
            if (outcome.kind === 'error') logger.error({ agent: agentId, schedule: schedule.slug, err: outcome.error }, 'scheduled run failed')
            if (outcome.kind !== 'done' || outcome.awaitingHuman || !stamped || !schedule.runAt) return
            try {
                if (await deleteFiredOneOff(agentId, schedule, firedAt)) logger.info({ agent: agentId, schedule: schedule.slug }, 'one-off schedule deleted after its run')
            } catch (err) {
                logger.warn({ agent: agentId, schedule: schedule.slug, err: String(err) }, 'one-off schedule delete failed')
            }
        })
        .finally(() => inFlight.delete(key))

    return started
}

// A routine the Chief of Staff set itself to come back to something: a check-in, under a daily cap.
// The occurrence is spent either way, so a capped or switched-off one does not fire on every tick.
async function firePromise(schedule: Schedule, opts?: { markFired?: boolean; manual?: boolean }): Promise<{ runId: string; sessionId: string }> {
    const capped = !opts?.manual && (await promisesInLastDay()) >= PROMISE_DAILY_CAP
    if (opts?.markFired !== false) await markFired(FOREMAN_AGENT_ID, schedule.slug, nowIso())
    if (capped) throw promiseCapReached()
    return startCheckin('promise', schedule)
}

const SKIP_REASONS: Record<string, string> = {
    promise_cap: 'promises of the Chief of Staff capped for the day',
    checkins_disabled: 'check-ins of the Chief of Staff switched off',
    budget_latched: 'rerun budget latched',
    coworker_busy: 'another run of the coworker is live',
    subscription_limited: 'subscription limit latched',
}

async function fire(agentId: string, schedule: Schedule): Promise<void> {
    try {
        await fireSchedule(agentId, schedule)
    } catch (err) {
        const skipReason = err instanceof HttpError && err.code ? SKIP_REASONS[err.code] : undefined
        if (skipReason) {
            logger.debug({ agent: agentId, schedule: schedule.slug }, `scheduled run skipped: ${skipReason}`)
            return
        }
        logger.error({ agent: agentId, schedule: schedule.slug, err: String(err) }, 'scheduled run failed')
    }
}

async function tick(): Promise<void> {
    const now = new Date()
    let agentIds: string[]
    try {
        agentIds = await listAgentIdsOnDisk()
    } catch (err) {
        logger.error({ err: String(err) }, 'scheduler tick failed to list agents')
        return
    }
    void announcePendingCheckins().catch(err => logger.warn({ err: String(err) }, 'check-in announcements failed'))
    void sweepMemoriesIfDue(agentIds)
    void maintainBrainIfDue()
    void sweepCodexHomesIfDue()
    for (const agentId of agentIds) {
        // A switched-off agent normally has its schedules paused too, so this only catches the
        // case where the host could not reach the box at the time. Skipping here rather than
        // letting fireSchedule throw keeps the tick from logging an error every 30 seconds.
        const agent = await getAgent(agentId).catch(() => null)
        if (!agent?.config.enabled) continue

        let schedules: Schedule[]
        try {
            schedules = await listSchedules(agentId)
        } catch (err) {
            logger.error({ agent: agentId, err: String(err) }, 'scheduler failed to load schedules')
            continue
        }
        // One coworker's schedules fire one after the other: the busy check in `fireSchedule` only
        // sees a run once `startHeadlessRun` has registered it, so two due together would both pass
        // it and race for the screen. Coworkers still fire beside each other.
        void (async () => {
            for (const schedule of schedules) {
                if (isDue(schedule, now)) await fire(agentId, schedule)
            }
        })()
    }
}

export function startScheduler(): () => void {
    void tick()
    const timer = setInterval(() => void tick(), TICK_MS)
    return () => clearInterval(timer)
}
