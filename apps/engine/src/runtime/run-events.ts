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
    // Set on a run the user or the engine stopped on purpose. The hub applies the session status
    // without filing a notification: a Stop must clear the "working" state, not post "Run finished".
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

// A stored run only keeps the trigger's slug, not its display name; the slug is the best label
// available when the terminal event is rebuilt outside the run loop.
// A wake keeps the member it speaks to in the slug column.
export function triggerFromRun(run: { triggerSource: string | null; triggerSlug: string | null }): RunTrigger {
    if (run.triggerSource === 'schedule') return { source: 'schedule', slug: run.triggerSlug ?? '', name: run.triggerSlug ?? 'schedule' }
    if (run.triggerSource === 'trigger') return { source: 'trigger', slug: run.triggerSlug ?? '', name: run.triggerSlug ?? 'trigger' }
    if (run.triggerSource === 'wake' && run.triggerSlug) return { source: 'wake', reason: 'interrupted', memberId: run.triggerSlug }
    return { source: 'chat' }
}

// What every event of a run nobody started carries: its source, and the member the hub chose to
// write to, which the hub checks against the workspace before it notifies anyone.
export function wakeOrigin(trigger: RunTrigger | undefined): { source?: 'wake' } {
    return trigger?.source === 'wake' ? { source: 'wake' } : {}
}

export function wakeMetadata(trigger: RunTrigger | undefined): Record<string, unknown> {
    return trigger?.source === 'wake' ? { memberId: trigger.memberId, wakeReason: trigger.reason } : {}
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

// The one place a run announces it is over. Every terminal path goes through it: the run loop's
// settle, the cancel route when it finds an orphan, and the boot reconciliation.
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
    Object.assign(metadata, wakeMetadata(trigger))
    // The routine's display name on its own, so the hub writes the notification in the reader's
    // language instead of parsing the English `message`, which stays for the hubs that still do.
    if (trigger.source === 'schedule' || trigger.source === 'trigger') metadata.sourceName = trigger.name
    // The hub titles an automated session after what its run did, from this answer: the routine's
    // name alone makes every run of it look the same in the list.
    const finalText = terminal.text?.trim()
    if (trigger.source !== 'chat' && finalText) metadata.finalText = finalText.slice(0, FINAL_TEXT_MAX)
    // Who sent the message, so the hub credits the run to that member rather than to the owner.
    if (trigger.source === 'chat' && trigger.author) metadata.authorId = trigger.author.id
    if (terminal.error) metadata.error = terminal.error
    if (terminal.errorCode) metadata.errorCode = terminal.errorCode
    // The hub classifies a notification as interactive or scheduled from the top-level `source`,
    // and without it every failing cron was read as an interactive run: the "Scheduled tasks"
    // preference silenced nothing and the errors arrived under the wrong switch. `chat` is not a
    // `session_source` on the hub side, and sending it would fail validation of the whole payload,
    // so an interactive run stays null.
    const source = trigger.source === 'chat' ? null : trigger.source
    await sendNotification({ event, kind: terminal.kind, agentId: terminal.agentId, sessionId: terminal.sessionId, runId: terminal.runId, message, source, metadata }).catch(() => {})
}
