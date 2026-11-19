import { FOREMAN_AGENT_ID, type CheckinReason } from '@rerun/contracts'
import { automationModel } from '../agents/availability.js'
import { pickBackup } from '../agents/backups.js'
import { getAgent } from '../agents/registry.js'
import { checkinsEnabled } from '../config/env.js'
import { isPlanLimitLatched } from '../connections/plan-limits.js'
import { listMembers } from '../db/repos/members.js'
import { createSession } from '../db/repos/sessions.js'
import { budgetExhausted, checkinsDisabled, subscriptionLimited } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { isBudgetLatched } from '../runtime/budget-latch.js'
import { startHeadlessRun } from '../runtime/headless-run.js'
import type { Schedule } from '../schedules/loader.js'
import { fetchCheckinBrief } from './brief.js'
import { writeCheckinLog } from './log.js'
import { buildCheckinMessage } from './message.js'

export const CHECKIN_SLUG = 'checkin'
export const CHECKIN_NAME = 'Check-in'

export type StartedCheckin = { runId: string; sessionId: string }

// One check-in at a time: a pulse and a promise due on the same tick would read the same workspace
// twice and could both decide to speak.
let inFlight: Promise<StartedCheckin> | null = null
let running: StartedCheckin | null = null

// A session nobody is told about: it only ever shows once the check-in decided to speak. The run
// is the Chief of Staff's, on the read-only brief of a check-in. `schedule` is the routine that asked
// for it, when the reason is a promise.
export async function startCheckin(reason: CheckinReason, schedule?: Pick<Schedule, 'slug' | 'name' | 'body' | 'connectionId' | 'model'>): Promise<StartedCheckin> {
    if (running) return running
    if (inFlight) return inFlight
    inFlight = launch(reason, schedule).finally(() => {
        inFlight = null
    })
    return inFlight
}

async function launch(reason: CheckinReason, schedule: Pick<Schedule, 'slug' | 'name' | 'body' | 'connectionId' | 'model'> | undefined): Promise<StartedCheckin> {
    const foreman = await getAgent(FOREMAN_AGENT_ID)
    if (!checkinsEnabled() || !foreman.config.proactive.enabled || !foreman.config.enabled) throw checkinsDisabled()
    const slug = schedule?.slug ?? CHECKIN_SLUG
    const name = schedule?.name ?? CHECKIN_NAME
    const pinned = schedule?.model ? schedule : foreman.config.proactive
    const override = await automationModel(foreman, { slug, connectionId: pinned.connectionId, model: pinned.model }, 'checkin')
    // Nobody asked for an automatic one: it waits for the credit or the subscription to come back,
    // with nothing created meanwhile. Someone who pressed the button is told why instead.
    if (reason !== 'manual' && override.provider === 'rerun' && isBudgetLatched()) throw budgetExhausted()
    if (reason !== 'manual' && override.connectionId && isPlanLimitLatched(override.connectionId) && !(await pickBackup(new Set([override.connectionId])))) throw subscriptionLimited()

    const [brief, members] = await Promise.all([fetchCheckinBrief(reason), listMembers().catch(() => [])])
    const session = await createSession(FOREMAN_AGENT_ID, `${CHECKIN_SLUG}: ${slug}`, undefined, 'schedule')
    const message = buildCheckinMessage({ slug, name, reason, members, promise: schedule?.body })
    const { runId, settled } = await startHeadlessRun({ ...foreman, brief }, session.id, message, override, { source: 'checkin', slug, name, reason })
    await writeCheckinLog(runId, { reason }).catch(err => logger.warn({ err: String(err), runId }, 'check-in log write failed'))
    const started = { runId, sessionId: session.id }
    running = started
    logger.info({ reason, slug, runId, session: session.id }, 'check-in started')
    void settled.finally(() => {
        if (running?.runId === runId) running = null
    })
    return started
}
