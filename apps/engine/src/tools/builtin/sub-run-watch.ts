import { PAID_DATA_TOOL, SUB_RUN_STOPPED_BY_USER, SUB_RUN_TOOL_NAMES } from '@rerun/contracts'
import { abortRun } from '../../runtime/run-control.js'
import type { AgentRun } from '../../runtime/loop.js'
import { BLOCKED_SOURCE_PREFIX, isFailureStatus } from '../host-breaker.js'
import { canonicalBridgeName } from './hitl.js'

export const SUB_RUN_IDLE_TIMEOUT_MS = 15 * 60_000
export const SUB_RUN_HEARTBEAT_MS = 30_000
export const SUB_RUN_STOPPED_WITH_CALLER = 'stopped along with the calling run'

const PREVIEW_LENGTH = 600
const RECENT_CALLS = 8
const SUMMARY_LENGTH = 80
const FAILURE_MARKERS = ['Command failed', 'Command timed out', 'Navigation failed', 'Fetch failed', 'Download failed', 'Search failed', BLOCKED_SOURCE_PREFIX]
const STATUS_PREFIX = /^\[(\d{3})\]/
const SECRET_IN_INPUT = /(bearer|token|key|secret|password)([=: ]+)\S+/gi
const URL_TOOLS = new Set(['web_fetch', 'browser_navigate', 'download'])
const SUB_RUN_TOOLS = new Set(Object.values(SUB_RUN_TOOL_NAMES))
const STOP_REASONS = new Set([SUB_RUN_STOPPED_BY_USER, SUB_RUN_STOPPED_WITH_CALLER])

export type SubRunCall = { tool: string; summary: string; startedAt: number; endedAt?: number; failed?: boolean }

export type SubRunCallSnapshot = { tool: string; summary: string; failed?: boolean; durationMs?: number; elapsedMs?: number }

export type SubRunProgress = {
    status: 'queued' | 'running' | 'done' | 'error' | 'stopped' | 'dispatched'
    steps: number
    toolCalls: number
    failures: number
    calls: SubRunCall[]
    activity?: string
    preview?: string
    startedAt?: number
    lastActivityAt?: number
    finishedAt?: number
    error?: string
}

export type SubRunOutcome = { text: string; stopReason?: string }

export function summarizeToolInput(toolName: string, input: unknown): string {
    const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const raw = pickSummary(toolName, fields)
    return raw.replace(SECRET_IN_INPUT, '$1$2***').split('\n')[0].trim().slice(0, SUMMARY_LENGTH)
}

function pickSummary(toolName: string, fields: Record<string, unknown>): string {
    if (toolName === 'shell_exec' && typeof fields.command === 'string') return fields.command
    if (URL_TOOLS.has(toolName) && typeof fields.url === 'string') {
        try {
            const url = new URL(fields.url)
            return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
        } catch {
            return fields.url
        }
    }
    if (/^(fs|shared)_/.test(toolName) && typeof fields.path === 'string') return fields.path
    if (toolName === PAID_DATA_TOOL && typeof fields.capability === 'string') {
        const params = fields.params && typeof fields.params === 'object' ? Object.values(fields.params) : []
        const subject = params.find((value): value is string => typeof value === 'string')
        return subject ? `${fields.capability} ${subject}` : fields.capability
    }
    const first = Object.values(fields).find((value): value is string => typeof value === 'string')
    return first ?? ''
}

function resultText(output: unknown): string {
    if (typeof output === 'string') return output
    if (!output || typeof output !== 'object') return ''
    const record = output as { type?: string; value?: unknown; content?: { text?: string }[] }
    if (record.type === 'text' && typeof record.value === 'string') return record.value
    if (Array.isArray(record.content)) return record.content.map(c => c.text ?? '').join('\n')
    return ''
}

export function isFailureResult(output: unknown): boolean {
    const text = resultText(output).trimStart()
    if (FAILURE_MARKERS.some(marker => text.startsWith(marker))) return true
    const status = STATUS_PREFIX.exec(text)
    return status !== null && isFailureStatus(Number(status[1]))
}

// Idle time is computed here rather than by the reader: the UI clock can drift from the engine's,
// and a stream replayed after a reload would otherwise date every part at the moment of the replay.
export function snapshotSubRun<T extends SubRunProgress>(progress: T): Omit<T, 'lastActivityAt' | 'calls'> & { idleMs?: number; calls: SubRunCallSnapshot[] } {
    const { lastActivityAt, calls, ...rest } = progress
    const now = Date.now()
    const snapshot = {
        ...rest,
        calls: calls.map(({ tool, summary, failed, startedAt, endedAt }) => (endedAt === undefined ? { tool, summary, failed, elapsedMs: now - startedAt } : { tool, summary, failed, durationMs: endedAt - startedAt })),
    }
    return progress.status === 'running' && lastActivityAt !== undefined ? { ...snapshot, idleMs: now - lastActivityAt } : snapshot
}

export function beginSubRun(progress: SubRunProgress): void {
    progress.status = 'running'
    progress.startedAt = Date.now()
    progress.lastActivityAt = progress.startedAt
    progress.toolCalls = 0
    progress.failures = 0
    progress.calls = []
}

export function endSubRun(progress: SubRunProgress, error?: string): void {
    progress.status = error === undefined ? 'done' : STOP_REASONS.has(error) ? 'stopped' : 'error'
    progress.error = error
    progress.finishedAt = Date.now()
}

export function startHeartbeat(emit: () => void): () => void {
    const timer = setInterval(emit, SUB_RUN_HEARTBEAT_MS)
    timer.unref?.()
    return () => clearInterval(timer)
}

const subRunStops = new Map<string, AbortController>()

export function registerSubRunStop(taskId: string): AbortSignal {
    const controller = new AbortController()
    subRunStops.set(taskId, controller)
    return controller.signal
}

export function unregisterSubRunStop(taskId: string): void {
    subRunStops.delete(taskId)
}

export function abortSubRun(taskId: string): boolean {
    const controller = subRunStops.get(taskId)
    if (!controller) return false
    subRunStops.delete(taskId)
    controller.abort(SUB_RUN_STOPPED_BY_USER)
    return true
}

export function renderSubRunOutcome({ text, stopReason }: SubRunOutcome, progress: SubRunProgress): string {
    if (stopReason === undefined) return text || '(the sub-coworker returned no text)'
    const tried = progress.calls.length ? `\n\nTools tried:\n${progress.calls.map(c => `- ${c.tool} ${c.summary}${c.failed ? ' (failed)' : ''}`.trimEnd()).join('\n')}` : ''
    const partial = text ? `\n\nPartial output:\n${text}` : ''
    return `(stopped: ${stopReason})${tried}${partial}`
}

type FollowOptions = {
    onChange: () => void
    parentSignal?: AbortSignal
    taskSignal?: AbortSignal
    idleTimeoutMs?: number
}

type StreamPart = { type: string; text?: string; toolName?: string; toolCallId?: string; input?: unknown; output?: unknown; error?: unknown }

/**
 * Drains a sub-run into `progress` and returns its text. A run that goes silent for the idle timeout,
 * whose parent is stopped, or whose task is stopped by hand, is aborted: a hung provider stream never
 * ends on its own, and the parent tool call would otherwise wait on it forever. Whatever the run had
 * already said comes back with the stop reason, so the caller keeps the partial work.
 */
export async function followSubRun(
    run: Pick<AgentRun, 'result' | 'runId'> & Partial<Pick<AgentRun, 'settled' | 'attempt'>>,
    progress: SubRunProgress,
    { onChange, parentSignal, taskSignal, idleTimeoutMs = SUB_RUN_IDLE_TIMEOUT_MS }: FollowOptions,
): Promise<SubRunOutcome> {
    let stop!: (reason: string) => void
    const stopped = new Promise<{ stopReason: string }>(resolve => {
        stop = stopReason => resolve({ stopReason })
    })

    const openCalls = new Map<string, SubRunCall>()
    let idleTimer: NodeJS.Timeout | undefined
    const armIdleTimer = () => {
        clearTimeout(idleTimer)
        // A run waiting on its own sub-run says nothing until that sub-run ends, and the watcher of
        // that sub-run already stops it if it hangs.
        if ([...openCalls.values()].some(call => SUB_RUN_TOOLS.has(call.tool))) return
        idleTimer = setTimeout(() => stop(`no activity for ${Math.round(idleTimeoutMs / 60_000)} min, sub-coworker stopped`), idleTimeoutMs)
        idleTimer.unref?.()
    }
    const onParentAbort = () => stop(SUB_RUN_STOPPED_WITH_CALLER)
    const onTaskAbort = () => stop(SUB_RUN_STOPPED_BY_USER)
    if (parentSignal?.aborted) onParentAbort()
    else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    if (taskSignal?.aborted) onTaskAbort()
    else taskSignal?.addEventListener('abort', onTaskAbort, { once: true })

    let attempt = run
    let iterator = (attempt.result.fullStream as AsyncIterable<StreamPart>)[Symbol.asyncIterator]()
    let text = ''
    let streamError: string | undefined
    armIdleTimer()
    try {
        while (true) {
            const next = await Promise.race([iterator.next(), stopped])
            if ('stopReason' in next) {
                await abortRun(run.runId)
                await run.settled
                return { text, stopReason: next.stopReason }
            }
            if (next.done) {
                // A sub-coworker whose subscription ran out carries on on a backup, in a stream of its own.
                const ended = await Promise.race([attempt.attempt ?? Promise.resolve({ kind: 'done' as const }), stopped])
                if ('kind' in ended && ended.kind === 'handover') {
                    attempt = ended.next
                    iterator = (attempt.result.fullStream as AsyncIterable<StreamPart>)[Symbol.asyncIterator]()
                    streamError = undefined
                    continue
                }
                if ('stopReason' in ended) {
                    await abortRun(run.runId)
                    await run.settled
                    return { text, stopReason: ended.stopReason }
                }
                break
            }

            const part = next.value
            progress.lastActivityAt = Date.now()
            armIdleTimer()
            if (part.type === 'error') streamError = part.error instanceof Error ? part.error.message : String(part.error)
            if (part.type === 'text-delta') text += part.text ?? ''
            else if (part.type === 'tool-call') {
                openCall(progress, openCalls, part)
                armIdleTimer()
            } else if (part.type === 'tool-result' || part.type === 'tool-error') {
                if (!closeCall(progress, openCalls, part)) continue
                armIdleTimer()
            } else if (part.type === 'finish-step') progress.steps += 1
            else continue
            progress.preview = text.slice(-PREVIEW_LENGTH)
            onChange()
        }
    } finally {
        clearTimeout(idleTimer)
        parentSignal?.removeEventListener('abort', onParentAbort)
        taskSignal?.removeEventListener('abort', onTaskAbort)
    }

    if (!text && streamError) return { text: '', stopReason: streamError }
    return { text }
}

function openCall(progress: SubRunProgress, openCalls: Map<string, SubRunCall>, part: StreamPart): void {
    const tool = canonicalBridgeName(part.toolName)
    const call: SubRunCall = { tool, summary: summarizeToolInput(tool, part.input), startedAt: Date.now() }
    progress.activity = tool
    progress.toolCalls += 1
    if (part.toolCallId) openCalls.set(part.toolCallId, call)
    progress.calls.push(call)
    if (progress.calls.length > RECENT_CALLS) progress.calls.splice(0, progress.calls.length - RECENT_CALLS)
}

function closeCall(progress: SubRunProgress, openCalls: Map<string, SubRunCall>, part: StreamPart): boolean {
    const call = part.toolCallId ? openCalls.get(part.toolCallId) : undefined
    if (!call) return false
    openCalls.delete(part.toolCallId!)
    call.endedAt = Date.now()
    call.failed = part.type === 'tool-error' || isFailureResult(part.output)
    progress.failures = call.failed ? progress.failures + 1 : 0
    return true
}
