import { stripBridgePrefix } from '@rerun/contracts'

import { hitlKindOf } from '@/lib/chat-hitl'

export type HitlCallPart = { type: string; toolName?: string; input?: unknown; output?: unknown }

type MessageLike = { role: string; parts: readonly { type: string }[] }

const toolNameOf = (part: HitlCallPart) => stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))

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
