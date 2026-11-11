import { billedMicrosOf, isPaidDataTool, toolNameOf } from '@rerun/contracts'

import { hitlKindOf, type HitlKind } from '@/lib/chat-hitl'

export type HitlCallPart = { type: string; toolName?: string; input?: unknown; output?: unknown }

type MessageLike = { role: string; parts: readonly { type: string }[] }

// The question a user reply answers: the last human-in-the-loop call of the assistant turn right
// before it. The reply text alone says what was decided; this call holds what was asked (slugs,
// labels, details). The part itself is returned, not a copy, so the memoised message keeps its props.
export function hitlCallBefore(messages: readonly MessageLike[], index: number): HitlCallPart | undefined {
    const previous = messages[index - 1]
    if (messages[index]?.role !== 'user' || previous?.role !== 'assistant') return undefined
    for (let i = previous.parts.length - 1; i >= 0; i--) {
        const part = previous.parts[i] as HitlCallPart
        if (hitlKindOf(toolNameOf(part))) return part
    }
    return undefined
}

export function hitlCallInput(call: HitlCallPart | undefined): Record<string, unknown> {
    return (call?.input ?? {}) as Record<string, unknown>
}

export function hitlCallKind(call: HitlCallPart | undefined): HitlKind | null {
    return call ? hitlKindOf(toolNameOf(call)) : null
}

// What the paid data calls billed between a spend reply and the user's next message: the run the
// approval started, so its receipt fills as the calls land.
export function spentAfter(messages: readonly MessageLike[], index: number): number {
    let total = 0
    for (let i = index + 1; i < messages.length && messages[i].role !== 'user'; i++) {
        for (const part of messages[i].parts as readonly HitlCallPart[]) {
            if (isPaidDataTool(toolNameOf(part))) total += billedMicrosOf(part.output)
        }
    }
    return total
}

export function isLatestUserMessage(messages: readonly MessageLike[], index: number): boolean {
    return messages[index]?.role === 'user' && messages.slice(index + 1).every(message => message.role !== 'user')
}
