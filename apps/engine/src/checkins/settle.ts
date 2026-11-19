import type { RunTerminal } from '../runtime/run-events.js'
import { logger } from '../lib/logger.js'
import { writeCheckinLog } from './log.js'

const NOTE_MAX = 500

// How a check-in ends: nobody is told. What it concluded is kept in its log, where the Chief of
// Staff's card reads it back.
export async function settleCheckin(terminal: RunTerminal): Promise<void> {
    if (!terminal.runId) return
    const note = terminal.kind === 'error' ? `Failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? 'Stopped' : terminal.text?.trim()
    await writeCheckinLog(terminal.runId, note ? { note: note.slice(0, NOTE_MAX) } : {}).catch(err => logger.warn({ err: String(err), runId: terminal.runId }, 'check-in log write failed'))
}
