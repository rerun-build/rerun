import { isToolPart, QUICK_REPLIES_TOOL, toolNameOf } from '@moldwright/contracts'

type PartLike = { type: string; toolCallId?: string; toolName?: string; state?: string }
type MessageLike = { role: string; parts: readonly PartLike[] }

const isQuickRepliesPart = (part: PartLike) => toolNameOf(part) === QUICK_REPLIES_TOOL

const userTurns = (messages: readonly MessageLike[]) => messages.filter(message => message.role === 'user').length

export function historyCovers(live: readonly MessageLike[], history: readonly MessageLike[]): boolean {
    if (userTurns(history) < userTurns(live)) return false
    const lastLive = live[live.length - 1]
    if (!lastLive || lastLive.role !== 'assistant') return true
    return history[history.length - 1]?.role === 'assistant'
}

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

export function needsReconcile(live: readonly MessageLike[]): boolean {
    const last = live[live.length - 1]
    if (!last || last.role !== 'assistant') return true
    if (hasDuplicateToolParts(last)) return true
    return last.parts.some(part => isToolPart(part) && !isQuickRepliesPart(part) && (part.state === 'input-streaming' || part.state === 'input-available'))
}
