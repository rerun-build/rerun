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

// A check-in spoke when it named who it is for and then wrote them something.
type Spoken = CheckinLog & { title: string }
const spoke = (log: CheckinLog | null): log is Spoken => !!log?.title && !!log.note?.trim()

// The end of a run and the retry of a tick can both reach the same check-in.
const announcing = new Set<string>()

// The thread first, then the end of the run, in that order and never the second alone: the hub
// opens the member's thread from the first, and the second only moves its status.
async function announce({ sessionId, runId }: { sessionId: string; runId: string }): Promise<boolean> {
    if (announcing.has(runId)) return false
    announcing.add(runId)
    try {
        const log = await readCheckinLog(runId)
        if (!spoke(log) || log.announcedAt) return false
        return await tellHub(sessionId, runId, log)
    } finally {
        announcing.delete(runId)
    }
}

async function tellHub(sessionId: string, runId: string, log: Spoken): Promise<boolean> {
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
    if (!terminal.runId || terminal.trigger.source !== 'checkin') return
    const runId = terminal.runId
    try {
        const note = terminal.kind === 'error' ? `Failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? 'Stopped' : terminal.text?.trim()
        // With its reason: a run that failed before it started has no log yet to merge the note into.
        if (note) await writeCheckinLog(runId, { reason: terminal.trigger.reason, note: note.slice(0, NOTE_MAX) })
        if (terminal.kind === 'done' && !terminal.cancelled) await announce({ sessionId: terminal.sessionId, runId })
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
        if (!spoke(log) || log.announcedAt) continue
        await announce({ sessionId: row.sessionId, runId: row.id }).catch(err => logger.warn({ err: String(err), runId: row.id }, 'check-in announce retry failed'))
    }
}
