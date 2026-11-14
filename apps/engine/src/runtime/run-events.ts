import { sendNotification, type NotificationEvent, type NotificationKind } from './notify.js'
import type { RunErrorCode } from './provider-errors.js'
import type { RunTrigger } from './context.js'

const FINAL_TEXT_MAX = 2000

export type RunTerminalKind = Extract<NotificationKind, 'done' | 'error'>

export type RunTerminal = {
    agentId: string
    sessionId: string
    runId: string | null
    trigger: RunTrigger
    kind: RunTerminalKind
    cancelled?: boolean
    text?: string
    error?: string
    errorCode?: RunErrorCode | null
    usage?: unknown
    stepCount?: number
    provider?: string
    model?: string
    costMicros?: number | null
}

export function triggerFromRun(run: { triggerSource: string | null; triggerSlug: string | null }): RunTrigger {
    if (run.triggerSource === 'schedule') return { source: 'schedule', slug: run.triggerSlug ?? '', name: run.triggerSlug ?? 'schedule' }
    if (run.triggerSource === 'trigger') return { source: 'trigger', slug: run.triggerSlug ?? '', name: run.triggerSlug ?? 'trigger' }
    return { source: 'chat' }
}

function describe(terminal: RunTerminal): { event: NotificationEvent; message: string } {
    const { trigger } = terminal
    const failed = terminal.kind === 'error'
    if (trigger.source === 'schedule') {
        return {
            event: 'agent.schedule.completed',
            message: failed ? `Schedule "${trigger.name}" failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? `Schedule "${trigger.name}" stopped` : `Schedule "${trigger.name}" completed`,
        }
    }
    if (trigger.source === 'trigger') {
        return {
            event: 'agent.trigger.completed',
            message: failed ? `Trigger "${trigger.name}" failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? `Trigger "${trigger.name}" stopped` : `Trigger "${trigger.name}" completed`,
        }
    }
    return {
        event: 'agent.message.completed',
        message: failed ? `Message failed: ${terminal.error ?? 'unknown error'}` : terminal.cancelled ? 'Message stopped' : terminal.text?.trim().slice(0, 200) || 'Message completed',
    }
}

export async function emitRunTerminal(terminal: RunTerminal): Promise<void> {
    const { event, message } = describe(terminal)
    const { trigger } = terminal
    const metadata: Record<string, unknown> = {
        source: trigger.source,
        status: terminal.cancelled ? 'cancelled' : terminal.kind,
        stepCount: terminal.stepCount,
        usage: terminal.usage ?? null,
        provider: terminal.provider ?? null,
        model: terminal.model ?? null,
        costMicros: terminal.costMicros ?? null,
    }
    if (trigger.source === 'schedule') metadata.scheduleSlug = trigger.slug
    if (trigger.source === 'trigger') metadata.triggerSlug = trigger.slug
    if (trigger.source !== 'chat') metadata.sourceName = trigger.name
    const finalText = terminal.text?.trim()
    if (trigger.source !== 'chat' && finalText) metadata.finalText = finalText.slice(0, FINAL_TEXT_MAX)
    if (trigger.source === 'chat' && trigger.author) metadata.authorId = trigger.author.id
    if (terminal.error) metadata.error = terminal.error
    if (terminal.errorCode) metadata.errorCode = terminal.errorCode
    const source = trigger.source === 'chat' ? null : trigger.source
    await sendNotification({ event, kind: terminal.kind, agentId: terminal.agentId, sessionId: terminal.sessionId, runId: terminal.runId, message, source, metadata }).catch(() => {})
}
