import { isToolPart, QUICK_REPLIES_TOOL, toolNameOf } from '@rerun/contracts'

type PartLike = { type: string; toolCallId?: string; toolName?: string; state?: string }
type MessageLike = { role: string; parts: readonly PartLike[] }

// The engine hands the replies over as a call with an input and no output: there is nothing
// left to wait for on it.
const isQuickRepliesPart = (part: PartLike) => toolNameOf(part) === QUICK_REPLIES_TOOL

const userTurns = (messages: readonly MessageLike[]) => messages.filter(message => message.role === 'user').length

/**
 * Whether the persisted transcript holds everything the live one shows: every user turn (the engine
 * writes that row when the run starts), and the answer of the last turn once the live side has one.
 * The assistant row lands after the stream closed, so right after a run ends the history can still
 * lack it. Counting assistant messages would mislead: a replay pushes its own on top of the one the
 * history already gave the chat.
 */
export function historyCovers(live: readonly MessageLike[], history: readonly MessageLike[]): boolean {
    if (userTurns(history) < userTurns(live)) return false
    const lastLive = live[live.length - 1]
    if (!lastLive || lastLive.role !== 'assistant') return true
    return history[history.length - 1]?.role === 'assistant'
}

/**
 * A run replayed onto the message that already holds its persisted answer: the AI SDK looks up a
 * streamed `dynamic-tool` part by type and never matches the static `tool-<name>` part the history
 * gave it, so every call lands twice and the streamed copy never gets its output.
 */
export function hasDuplicateToolParts(message: MessageLike): boolean {
    const staticIds = new Set<string>()
    const dynamicIds = new Set<string>()
    for (const part of message.parts) {
        if (!isToolPart(part) || !part.toolCallId) continue
        if (part.type === 'dynamic-tool') dynamicIds.add(part.toolCallId)
        else staticIds.add(part.toolCallId)
    }
    for (const id of dynamicIds) if (staticIds.has(id)) return true
    return false
}

/**
 * Whether the live transcript still needs the persisted one once the run is over: no answer at all
 * (nothing streamed), a call left without its output, or a call held twice. `approval-requested`
 * is a real waiting state, not a missing output.
 */
export function needsReconcile(live: readonly MessageLike[]): boolean {
    const last = live[live.length - 1]
    if (!last || last.role !== 'assistant') return true
    if (hasDuplicateToolParts(last)) return true
    return last.parts.some(part => isToolPart(part) && !isQuickRepliesPart(part) && (part.state === 'input-streaming' || part.state === 'input-available'))
}
