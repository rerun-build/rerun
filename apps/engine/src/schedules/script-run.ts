import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { constants } from 'node:os'
import { resolve, sep } from 'node:path'
import { SCRIPT_DEFAULT_FOLDER, SCRIPT_TIMEOUT_EXIT_CODE, scheduleScriptSchema, type ScheduleScript } from '@rerun/contracts'
import { agentProcessEnv } from '../agents/process-env.js'
import type { LoadedAgent } from '../agents/types.js'
import { sharedDir } from '../config/paths.js'
import { startScriptRun } from '../db/repos/runs.js'
import { childProcessEnv } from '../lib/child-env.js'
import { nowIso } from '../lib/ids.js'
import { logger } from '../lib/logger.js'
import { registerRunAbort, setRunCancel, unregisterRunAbort } from '../runtime/run-control.js'
import { assertCommandAllowed } from '../tools/sandbox.js'
import { deleteFiredOneOff, markFired, type Schedule } from './loader.js'
import { runOnComputer } from './script-remote.js'
import { failure, keepTail, settleAndAnnounce, timeoutLabel, SCRIPT_OUTPUT_MAX_CHARS, type CommandResult } from './script-result.js'

const KILL_GRACE_MS = 5_000
// After the shell exits, what it printed last still has this long to come through. A process it left
// in the background keeps the pipes open and is left to run.
const PIPE_DRAIN_MS = 2_000

// `shared/…` is the folder every coworker of the workspace shares, `workspace/…` this coworker's own.
// Anything else, or a path climbing out of them, is refused: the routine names a folder the Files tab
// shows, not a place on the machine.
export function scriptFolderPath(workspace: string, folder: string): string | null {
    const [root, ...rest] = (folder.trim() || SCRIPT_DEFAULT_FOLDER).split(/[\\/]+/).filter(Boolean)
    const base = root === 'shared' ? sharedDir() : root === 'workspace' ? workspace : null
    if (!base) return null
    const path = resolve(base, ...rest)
    return path === base || path.startsWith(base + sep) ? path : null
}

export function isValidScriptFolder(folder: string): boolean {
    return scriptFolderPath(resolve(sep, 'workspace'), folder) !== null
}

function signalExitCode(signal: NodeJS.Signals | null): number | null {
    const number = signal ? constants.signals[signal] : undefined
    return number ? 128 + number : null
}

// Runs in a process group of its own, so the limit or a cancel stops what the command started too.
export function runShellCommand({ command, cwd, env, timeoutMs, abort }: { command: string; cwd: string; env: Record<string, string>; timeoutMs: number; abort?: AbortSignal }): Promise<CommandResult> {
    return new Promise(done => {
        let output = ''
        let stopped: 'limit' | 'cancel' | null = null
        let killTimer: NodeJS.Timeout | undefined
        let drainTimer: NodeJS.Timeout | undefined
        let settled = false
        const child = spawn('/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const killGroup = (signal: NodeJS.Signals) => {
            try {
                if (child.pid) process.kill(-child.pid, signal)
            } catch {
                // Already gone.
            }
        }
        const stop = (reason: 'limit' | 'cancel') => {
            if (stopped || settled) return
            stopped = reason
            killGroup('SIGTERM')
            killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS)
        }
        const onAbort = () => stop('cancel')
        const finish = (result: Omit<CommandResult, 'output'>) => {
            if (settled) return
            settled = true
            // A run that says it was stopped leaves nothing running: what outlived the SIGTERM of a
            // shell that died of it would otherwise never be killed.
            if (stopped) killGroup('SIGKILL')
            clearTimeout(timer)
            clearTimeout(killTimer)
            clearTimeout(drainTimer)
            abort?.removeEventListener('abort', onAbort)
            done({ ...result, output: keepTail(output) })
        }
        const ended = (code: number | null, signal: NodeJS.Signals | null): Omit<CommandResult, 'output'> => {
            if (stopped === 'limit') return { exitCode: SCRIPT_TIMEOUT_EXIT_CODE, timedOut: true, error: `Stopped after ${timeoutLabel(timeoutMs / 1000)}` }
            const exitCode = code ?? signalExitCode(signal)
            if (stopped === 'cancel') return { exitCode, timedOut: false, cancelled: true, error: 'Stopped' }
            return { exitCode, timedOut: false, error: exitCode === 0 ? null : signal ? `Killed by ${signal}` : `Exit code ${exitCode}` }
        }
        const keep = (chunk: Buffer) => {
            output += chunk.toString('utf8')
            if (output.length > SCRIPT_OUTPUT_MAX_CHARS * 2) output = output.slice(-SCRIPT_OUTPUT_MAX_CHARS - 1)
        }
        const timer = setTimeout(() => stop('limit'), timeoutMs)
        if (abort?.aborted) onAbort()
        else abort?.addEventListener('abort', onAbort, { once: true })
        child.stdout.on('data', keep)
        child.stderr.on('data', keep)
        child.on('error', err => finish({ exitCode: null, timedOut: false, error: err.message }))
        child.on('exit', (code, signal) => {
            clearTimeout(timer)
            drainTimer = setTimeout(() => {
                child.stdout.destroy()
                child.stderr.destroy()
                finish(ended(code, signal))
            }, PIPE_DRAIN_MS)
        })
        child.on('close', (code, signal) => finish(ended(code, signal)))
    })
}

async function runOnWorkspaceMachine(agent: LoadedAgent, command: string, script: ScheduleScript, abort: AbortSignal): Promise<CommandResult> {
    const { cwd: workspace, env } = agentProcessEnv(agent)
    const cwd = scriptFolderPath(workspace, script.folder)
    if (!cwd) return failure(`The folder ${script.folder} is not inside shared/ or workspace/.`)
    mkdirSync(sharedDir(), { recursive: true })
    if (!existsSync(cwd)) return failure(`The folder ${script.folder} does not exist.`)
    try {
        assertCommandAllowed(command)
    } catch (err) {
        return failure((err as Error).message)
    }
    return runShellCommand({ command, cwd, env: childProcessEnv(env), timeoutMs: script.timeoutSec * 1000, abort })
}

// No model, no conversation: the command runs as it is and its run keeps the exit code and the end of
// what it printed. Stamped before the launch for the same reason as a coworker's routine. The run is
// live like any other: an update of the engine waits for it, and a cancel stops it.
export async function fireScript(agent: LoadedAgent, schedule: Schedule, opts?: { markFired?: boolean }): Promise<{ runId: string; settled: Promise<void> }> {
    const script = schedule.script ?? scheduleScriptSchema.parse({})
    const stamped = opts?.markFired !== false
    const firedAt = nowIso()
    if (stamped) await markFired(agent.id, schedule.slug, firedAt)
    const run = await startScriptRun(agent.id, schedule.slug)
    const { signal } = registerRunAbort(run.id, agent.id, { script: true })
    logger.info({ agent: agent.id, schedule: schedule.slug, runId: run.id, runsOn: script.runsOn ?? 'workspace' }, 'script routine fired')

    const execute = script.runsOn ? runOnComputer(agent, schedule.body, script, { runId: run.id, slug: schedule.slug, name: schedule.name, abort: signal }) : runOnWorkspaceMachine(agent, schedule.body, script, signal)
    const settled = execute
        .catch((err: unknown) => failure(err instanceof Error ? err.message : String(err)))
        .then(async result => {
            await settleAndAnnounce(agent.id, run.id, { ...schedule, script }, result)
            if (result.cancelled) return
            if (result.exitCode !== 0) logger.warn({ agent: agent.id, schedule: schedule.slug, exitCode: result.exitCode, error: result.error }, 'script routine failed')
            if (result.exitCode === 0 && stamped && schedule.runAt) await deleteFiredOneOff(agent.id, schedule, firedAt)
        })
        .catch(err => logger.error({ agent: agent.id, schedule: schedule.slug, err: String(err) }, 'script routine could not be settled'))
        .finally(() => unregisterRunAbort(run.id))
    setRunCancel(run.id, () => settled)
    return { runId: run.id, settled }
}
