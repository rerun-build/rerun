import { pendingApprovals, pendingComputerAccess, pendingQuestions } from '@rerun/contracts'

import { liveActivityLabel, type LiveActivityCopy } from '@/lib/agent-chat-loader'

import { isEngineHitl, type PendingWidget } from './pending-widget'

export type ForemanDockReply = { id: string; text: string }

/** What the parked Foreman shows of a conversation whose column is closed. */
export type ForemanDockFeed = {
    busy: boolean
    /** What the run is doing right now. Null leaves the pill on its generic rotation. */
    label: string | null
    pending: PendingWidget | null
    reply: ForemanDockReply | null
    failed: boolean
}

export const IDLE_DOCK_FEED: ForemanDockFeed = { busy: false, label: null, pending: null, reply: null, failed: false }

type PartLike = { type: string; text?: string }
type MessageLike = { id: string; role: string; parts: readonly PartLike[] }

type FeedInput = {
    messages: readonly MessageLike[]
    busy: boolean
    pending: PendingWidget | null
    failed: boolean
    copy: LiveActivityCopy
}

// The bubble shows a few lines of plain text: the marks of the markdown it does not render would
// only be noise in it.
function plain(markdown: string): string {
    return markdown
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*|__|`/g, '')
        .trim()
}

function lastReply(messages: readonly MessageLike[]): ForemanDockReply | null {
    const last = messages.at(-1)
    if (!last || last.role !== 'assistant') return null
    const text = plain(last.parts.findLast(part => part.type === 'text' && part.text?.trim())?.text ?? '')
    return text ? { id: last.id, text } : null
}

export function foremanDockFeed({ messages, busy, pending, failed, copy }: FeedInput): ForemanDockFeed {
    if (busy) return { ...IDLE_DOCK_FEED, busy: true, label: liveActivityLabel(messages.at(-1), copy) }
    const question = pending && isEngineHitl(pending.toolName) ? pending : null
    // A turn stopped on a question has said nothing yet: the question is the reply.
    return { busy: false, label: null, pending: question, reply: question || failed ? null : lastReply(messages), failed }
}

export type ForemanNudge = { id: string; kind: 'question' | 'approval'; title: string; detail: string | null; more: number }

/**
 * The one line of a pending request the parked Foreman holds up. `label` is what the scroll cue says
 * of a request that is neither a question nor an approval (a key, an app, paid data, the browser).
 */
export function foremanNudge(pending: PendingWidget, label: string): ForemanNudge {
    const input = (pending.input ?? {}) as Record<string, unknown>
    if (pending.toolName !== 'ask_user' && pending.toolName !== 'request_approval' && pending.toolName !== 'request_computer_access') {
        const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : null
        return { id: pending.toolCallId, kind: 'approval', title: label, detail: reason, more: 0 }
    }
    // What it would run or open on the computer is the thing to judge, the reason comes under it.
    if (pending.toolName === 'request_computer_access') {
        const request = pendingComputerAccess(input)
        const items = [...request.commands, ...request.paths]
        return { id: pending.toolCallId, kind: 'approval', title: items[0] ?? request.reason, detail: items.length ? request.reason || null : null, more: Math.max(items.length - 1, 0) }
    }
    if (pending.toolName === 'request_approval') {
        const approvals = pendingApprovals(input)
        return { id: pending.toolCallId, kind: 'approval', title: approvals[0].action, detail: approvals[0].detail ?? null, more: approvals.length - 1 }
    }
    const questions = pendingQuestions(input)
    return { id: pending.toolCallId, kind: 'question', title: questions[0].question, detail: null, more: questions.length - 1 }
}
