import { isPinnable, type SkillProposal } from '@rerun/contracts'

import { findPendingHitl, type PendingHitl } from '@/lib/chat-hitl'

type PeekMessage = { role: string; parts: readonly unknown[] }

// What a coworker waits on is answered where it shows, the inbox or its row in General; any other
// status that needs someone still opens the conversation.
export const PEEK_STATUSES: ReadonlySet<string> = new Set(['awaiting_question', 'awaiting_approval', 'awaiting_connector'])

export type PendingRequestPeek = {
    pending: Pick<PendingHitl, 'kind' | 'toolCallId' | 'input'> | null
    /** What the agent wrote to ask: the paragraph right before its request, and any written after it. */
    ask: string
    /** What the agent wrote before that, in the same turn or the turn before it. */
    before: string | null
    /**
     * A skill the agent offered to keep. It never pauses the run, yet the engine announces it as an
     * approval, so the conversation waits on it once its turn is over. That turn ends on the agent's
     * whole result, not on a line that asks: when the proposal is what waits, all of it goes to `before`.
     */
    proposal: SkillProposal | null
}

// The one a decision is still owed on, by the dock's own rule: the latest, should a turn raise two.
export function openSkillProposal(proposals: readonly SkillProposal[]): SkillProposal | null {
    return proposals.filter(proposal => isPinnable(proposal.status)).reduce<SkillProposal | null>((latest, proposal) => (latest && latest.createdAt >= proposal.createdAt ? latest : proposal), null)
}

type PeekPart = { type: string; text?: string; toolCallId?: string }

const textOf = (part: PeekPart) => (part.type === 'text' ? (part.text?.trim() ?? '') : '')

// Text parts written in separate steps of one turn are separate paragraphs, not one run-on line.
const joined = (texts: string[]) => texts.filter(Boolean).join('\n\n')

// What a conversation waits on, with just enough of the thread around it to answer without opening it.
// The engine keeps a whole turn in one message, the work that led to the request included: the
// paragraph that asks is kept apart from what came before it, which the inbox folds.
export function pendingRequestPeek(messages: readonly PeekMessage[], proposal: SkillProposal | null = null): PendingRequestPeek {
    const last = messages[messages.length - 1]
    if (last?.role !== 'assistant') return { pending: null, ask: '', before: null, proposal }
    const found = findPendingHitl(messages)
    const parts = last.parts as readonly PeekPart[]
    const previous = messages[messages.length - 2]
    const previousTurn = previous?.role === 'assistant' ? joined((previous.parts as readonly PeekPart[]).map(textOf)) : ''

    const callIndex = found ? parts.findIndex(part => part.toolCallId === found.toolCallId) : -1
    const leading = (callIndex === -1 ? parts : parts.slice(0, callIndex)).map(textOf).filter(Boolean)
    const trailing = callIndex === -1 ? [] : parts.slice(callIndex + 1).map(textOf)
    const proposalWaits = callIndex === -1 && proposal !== null
    const asking = callIndex === -1 ? (proposalWaits ? [] : leading) : [...leading.slice(-1), ...trailing]
    const earlier = callIndex === -1 ? (proposalWaits ? leading : []) : leading.slice(0, -1)

    return {
        pending: found && { kind: found.kind, toolCallId: found.toolCallId, input: found.input },
        ask: joined(asking),
        before: joined([previousTurn, ...earlier]) || null,
        proposal,
    }
}
