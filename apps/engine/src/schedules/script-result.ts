import type { ScheduleScript } from '@rerun/contracts'
import { SCRIPT_RUN_SESSION_ID, settleScriptRun } from '../db/repos/runs.js'
import { emitRunTerminal } from '../runtime/run-events.js'
import type { Schedule } from './loader.js'

// What a run keeps of what the command printed: the end, where the error is.
export const SCRIPT_OUTPUT_MAX_CHARS = 64_000
export const SCRIPT_OUTPUT_CUT_MARK = '[… earlier output cut]\n'

// `cancelled`: stopped by whoever cancelled its run, which is neither a success nor a failure.
export type CommandResult = { exitCode: number | null; output: string; timedOut: boolean; error: string | null; cancelled?: boolean }

export function keepTail(output: string): string {
    return output.length > SCRIPT_OUTPUT_MAX_CHARS ? SCRIPT_OUTPUT_CUT_MARK + output.slice(-SCRIPT_OUTPUT_MAX_CHARS) : output
}

export function timeoutLabel(timeoutSec: number): string {
    return timeoutSec >= 3600 ? `${timeoutSec / 3600} h` : `${Math.round(timeoutSec / 60)} min`
}

export function failure(error: string): CommandResult {
    return { exitCode: null, output: error, timedOut: false, error }
}

// The last line it printed says more than a code alone, in the notification and in the email.
export function failureText(result: CommandResult): string {
    const lastLine = result.output.trim().split('\n').at(-1)?.trim()
    const head = result.timedOut ? (result.error ?? 'timed out') : result.exitCode !== null ? `exit code ${result.exitCode}` : (result.error ?? 'did not run')
    return lastLine && lastLine !== head ? `${head}: ${lastLine.slice(0, 300)}` : head
}

export async function settleAndAnnounce(agentId: string, runId: string, schedule: Pick<Schedule, 'slug' | 'name'> & { script: ScheduleScript | null }, result: CommandResult): Promise<void> {
    const failed = !result.cancelled && result.exitCode !== 0
    await settleScriptRun(agentId, runId, { status: result.cancelled ? 'cancelled' : failed ? 'error' : 'done', exitCode: result.exitCode, output: result.output, error: failed ? failureText(result) : null })
    await emitRunTerminal({
        agentId,
        sessionId: SCRIPT_RUN_SESSION_ID,
        runId,
        trigger: { source: 'schedule', slug: schedule.slug, name: schedule.name },
        kind: failed ? 'error' : 'done',
        cancelled: result.cancelled,
        error: failed ? failureText(result) : undefined,
        script: { exitCode: result.exitCode, timedOut: result.timedOut, notify: schedule.script?.notify ?? 'failures' },
    })
}
