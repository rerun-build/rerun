import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { and, eq, gte, isNotNull } from 'drizzle-orm'
import { getSystemDb } from '../db/systemDb.js'
import { runs } from '../db/schema.js'
import { logger } from '../lib/logger.js'
import { nowIso } from '../lib/ids.js'
import { sendNotification } from '../runtime/notify.js'
import type { RunTerminal } from '../runtime/run-events.js'
import { parseCheckinLog, readCheckinLog, writeCheckinLog, type CheckinLog } from './log.js'

const NOTE_MAX = 2000
const PREVIEW_MAX = 200

// A check-in that spoke and whose announcement did not reach the hub is tried again on the next
// ticks, for this long. Past it, what it had to say is no longer news.
const RETRY_WINDOW_MS = 48 * 60 * 60_000

type Announced = { sessionId: string; runId: string; log: CheckinLog }

// The thread first, then the end of the run, in that order and never the second alone: the hub
// opens the member's thread from the first, and the second only moves its status.
async function announce({ sessionId, runId, log }: Announced): Promise<boolean> {
    if (!log.title) return false
    const preview = log.note?.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX)
    const opened = await sendNotification({
        event: 'agent.session.created',
        kind: 'info',
        agentId: FOREMAN_AGENT_ID,
        sessionId,
        runId,
        message: preview || log.title,
        title: log.title,
        source: 'schedule',
        metadata: { checkin: { reason: log.reason }, ...(log.reportedTo ? { memberId: log.reportedTo } : {}), aboutAgentIds: log.about ?? [] },
    })
    if (!opened.delivered) return false
    await writeCheckinLog(runId, { announcedAt: nowIso() })
    await sendNotification({ event: 'agent.schedule.completed', kind: 'done', agentId: FOREMAN_AGENT_ID, sessionId, runId, message: log.title, source: 'schedule', metadata: { source: 'schedule', status: 'done', checkin: { reason: log.reason } } })
    return true
}

// How a check-in ends. One with nothing to say tells nobody: what it concluded stays in its log,
// where the Chief of Staff's card reads it back. One that decided to speak is announced.
export async function settleCheckin(terminal: RunTerminal): Promise<void> {
    if (!terminal.runId) return
    const runId = terminal.runId
    try {
        const note = terminal.kind === 'error' ? `Failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? 'Stopped' : terminal.text?.trim()
        if (note) await writeCheckinLog(runId, { note: note.slice(0, NOTE_MAX) })
        const log = await readCheckinLog(runId)
        const spoke = terminal.kind === 'done' && !terminal.cancelled && !!terminal.text?.trim() && !!log?.title
        if (spoke && log) await announce({ sessionId: terminal.sessionId, runId, log })
    } catch (err) {
        logger.warn({ err: String(err), runId }, 'check-in settle failed')
    }
}

// The check-ins that spoke and that the hub never heard, from the last two days.
export async function announcePendingCheckins(now = Date.now()): Promise<void> {
    const { db } = await getSystemDb(FOREMAN_AGENT_ID)
    const since = new Date(now - RETRY_WINDOW_MS).toISOString()
    const rows = await db
        .select({ id: runs.id, sessionId: runs.sessionId, checkinJson: runs.checkinJson })
        .from(runs)
        .where(and(eq(runs.triggerSource, 'checkin'), eq(runs.status, 'done'), isNotNull(runs.checkinJson), gte(runs.startedAt, since)))
    for (const row of rows) {
        const log = parseCheckinLog(row.checkinJson)
        if (!log?.title || log.announcedAt) continue
        await announce({ sessionId: row.sessionId, runId: row.id, log }).catch(err => logger.warn({ err: String(err), runId: row.id }, 'check-in announce retry failed'))
    }
}
