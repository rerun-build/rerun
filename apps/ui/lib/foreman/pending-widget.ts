import { hitlInputIsUsable, hitlKindOf, stripBridgePrefix } from '@rerun/contracts'
import { lastAssistantMessageIsCompleteWithToolCalls, type ChatStatus, type UIMessage } from 'ai'

import { isForemanWidgetTool, type ForemanWidgetToolName } from './tool-defs'

export type EngineHitlToolName = 'ask_user' | 'request_approval'

export type PendingWidget = { toolName: ForemanWidgetToolName | EngineHitlToolName; toolCallId: string; input: unknown }

export function isEngineHitl(toolName: string): toolName is EngineHitlToolName {
    return toolName === 'ask_user' || toolName === 'request_approval'
}

export function keepsComposer(pending: PendingWidget): boolean {
    return pending.toolName === 'contact_team' || pending.toolName === 'show_starter_pack'
}

type ToolPart = { type: string; toolCallId?: string; toolName?: string; state?: string; input?: unknown; rawInput?: unknown; output?: unknown }

export function widgetName(part: ToolPart): ForemanWidgetToolName | null {
    if (!part.type.startsWith('tool-')) return null
    const name = part.type.slice('tool-'.length)
    return isForemanWidgetTool(name) ? name : null
}

export function findPendingWidget(messages: UIMessage[], status: ChatStatus): PendingWidget | null {
    if (status === 'streaming' || status === 'submitted') return null
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return null

    for (let index = last.parts.length - 1; index >= 0; index--) {
        const part = last.parts[index] as ToolPart
        const toolName = widgetName(part)
        if (!toolName || part.state !== 'input-available' || !part.toolCallId) continue
        return { toolName, toolCallId: part.toolCallId, input: part.input }
    }
    return null
}

export function resumesAfterAnswer({ messages }: { messages: UIMessage[] }): boolean {
    if (messages.at(-1)?.parts.some(part => part.type === 'tool-build_team')) return false
    return lastAssistantMessageIsCompleteWithToolCalls({ messages })
}

export function findPendingEngineHitl(messages: UIMessage[], status: ChatStatus): PendingWidget | null {
    if (status === 'streaming' || status === 'submitted') return null
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return null

    for (let index = last.parts.length - 1; index >= 0; index--) {
        const part = last.parts[index] as ToolPart
        const rawName = part.type === 'dynamic-tool' ? part.toolName : part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
        if (!rawName || !part.toolCallId) continue
        const kind = hitlKindOf(rawName)
        if (kind !== 'question' && kind !== 'approval') continue
        const input = (part.input ?? part.rawInput ?? {}) as Record<string, unknown>
        if (!hitlInputIsUsable(kind, input)) return null
        return { toolName: stripBridgePrefix(rawName) as EngineHitlToolName, toolCallId: part.toolCallId, input }
    }
    return null
}
