import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { getAgent } from '../agents/registry.js'
import { hasPendingSetup } from '../agents/setup.js'
import { listAgentIndex } from '../db/repos/agents.js'
import { newId } from '../lib/ids.js'
import { logger } from '../lib/logger.js'
import { onNotification, type NotificationInput } from '../runtime/notify.js'
import { RUN_ERROR_CODES } from '../runtime/provider-errors.js'
import { readWakeState, updateWakeState, type WakeSignal } from './wake-state.js'

const MINUTE_MS = 60_000
// A few failures that land together wake it once: a signal waits two minutes for its siblings.
const GROUP_MS = 2 * MINUTE_MS
// A conversation waiting on someone is only news once nobody answered for four hours.
const AWAITING_MS = 4 * 60 * MINUTE_MS
const SIGNAL_CAP = 50
const SUMMARY_MAX = 300

export type SignalInput = { kind: string; agentId?: string; sessionId?: string; itemId?: string; memberId?: string; summary: string; delayMs?: number }

function keyOf(signal: Pick<SignalInput, 'kind' | 'agentId' | 'sessionId' | 'itemId'>): string {
    return [signal.kind, signal.agentId ?? '', signal.sessionId ?? '', signal.itemId ?? ''].join('|')
}

// Queued until it matures. The same thing happening again (the same coworker failing in the same
// conversation) is counted on the signal already there rather than queued twice.
export function recordSignal(input: SignalInput, now = new Date()): Promise<void> {
    const key = keyOf(input)
    const summary = input.summary.trim().slice(0, SUMMARY_MAX)
    return updateWakeState(state => {
        const existing = state.signals.find(signal => signal.key === key)
        if (existing) {
            existing.count += 1
            existing.summary = summary
            existing.at = now.toISOString()
            existing.memberId = input.memberId ?? existing.memberId
            return
        }
        const signal: WakeSignal = {
            id: newId(),
            key,
            kind: input.kind,
            ...(input.agentId ? { agentId: input.agentId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.itemId ? { itemId: input.itemId } : {}),
            ...(input.memberId ? { memberId: input.memberId } : {}),
            summary,
            count: 1,
            at: now.toISOString(),
            dueAt: new Date(now.getTime() + (input.delayMs ?? GROUP_MS)).toISOString(),
        }
        state.signals = [...state.signals, signal].slice(-SIGNAL_CAP)
    })
}

// Someone answered the conversation, or a run started in it: whatever it was waiting on is no news.
// Read first: this runs at the start of every conversation turn, and almost never finds anything.
export async function clearAwaitingSignal(agentId: string, sessionId: string): Promise<void> {
    if (agentId === FOREMAN_AGENT_ID) return
    const waiting = (signal: WakeSignal) => signal.kind === 'awaiting_human' && signal.agentId === agentId && signal.sessionId === sessionId
    if (!(await readWakeState()).signals.some(waiting)) return
    await updateWakeState(state => {
        state.signals = state.signals.filter(signal => !waiting(signal))
    })
}

const HITL_KINDS = new Set(['question', 'approval', 'connector'])

function metadataOf(input: NotificationInput): Record<string, unknown> {
    return (input.metadata ?? {}) as Record<string, unknown>
}

function memberOf(metadata: Record<string, unknown>): string | undefined {
    return typeof metadata.authorId === 'string' ? metadata.authorId : undefined
}

// A coworker of the board: neither the Chief of Staff itself, nor a sub-coworker of a delegated
// task, which reports its end under an id of its own.
async function coworkerName(agentId: string | null | undefined): Promise<string | null> {
    if (!agentId || agentId === FOREMAN_AGENT_ID) return null
    const agent = await getAgent(agentId).catch(() => null)
    if (!agent || agent.config.ephemeral) return null
    return agent.config.displayName || agent.config.name
}

export async function signalOf(input: NotificationInput): Promise<SignalInput | null> {
    const metadata = metadataOf(input)
    if (input.event === 'box.vault.signed_out') {
        return { kind: 'vault_signed_out', itemId: typeof metadata.itemId === 'string' ? metadata.itemId : undefined, summary: `The app "${input.message}" was signed out of the Vault: its token can no longer be refreshed, and the coworkers using it fail until someone reconnects it.` }
    }
    if (input.event === 'box.connection.connected') {
        return { kind: 'provider_connected', itemId: input.message, summary: `The workspace connected its own AI (${input.message}): coworkers can now run on it.` }
    }

    const name = await coworkerName(input.agentId)
    if (!name || !input.agentId) return null
    const completed = input.event === 'agent.message.completed' || input.event === 'agent.schedule.completed' || input.event === 'agent.trigger.completed'
    if (completed && input.kind === 'error' && metadata.status !== 'cancelled') {
        if (metadata.errorCode === RUN_ERROR_CODES.engineRestarted) return { kind: 'runs_interrupted', summary: `Runs were cut short by a restart of the box, ${name}'s among them.` }
        return { kind: 'run_failed', agentId: input.agentId, sessionId: input.sessionId ?? undefined, memberId: memberOf(metadata), summary: `${name} (${input.agentId}) failed: ${input.message}` }
    }
    const waits = input.event === 'agent.notification' && HITL_KINDS.has(input.kind) && typeof metadata.toolName === 'string' && metadata.toolName !== 'skill_propose'
    if (waits && input.sessionId) {
        return { kind: 'awaiting_human', agentId: input.agentId, sessionId: input.sessionId, memberId: memberOf(metadata), summary: `${name} (${input.agentId}) has been waiting on someone: ${input.message}`, delayMs: AWAITING_MS }
    }
    return null
}

// Every event of the box goes through sendNotification: the Chief of Staff hears the ones worth a look.
export function installForemanSignals(): () => void {
    return onNotification(input => {
        void signalOf(input)
            .then(signal => (signal ? recordSignal(signal) : undefined))
            .catch(err => logger.warn({ err: String(err) }, 'foreman signal dropped'))
    })
}

// What a wake reads on top of its signals: the coworkers whose setup nobody finished. No event says
// so, the agents on disk do.
export async function pendingSetups(): Promise<string[]> {
    const index = await listAgentIndex().catch(() => [])
    const names: string[] = []
    for (const row of index) {
        const agent = await getAgent(row.id).catch(() => null)
        if (agent && hasPendingSetup(agent)) names.push(`${agent.config.displayName || agent.config.name} (${agent.id})`)
    }
    return names
}
