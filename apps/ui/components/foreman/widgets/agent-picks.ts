import { AGENT_TAB_LABELS, resolveTab, type AgentFocusTab } from '@/lib/board/types'
import { stripBridgePrefix } from '@/lib/chat/bridge-name'

export type AgentPick = { agentId: string; tab: AgentFocusTab | null; conversationId: string | null; runId: string | null }

function text(entry: object, key: string): string | null {
    const value = (entry as Record<string, unknown>)[key]
    return typeof value === 'string' && value ? value : null
}

export function readAgentPicks(input: unknown): AgentPick[] {
    const agents = input && typeof input === 'object' ? (input as { agents?: unknown }).agents : undefined
    if (!Array.isArray(agents)) return []
    return agents.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return []
        const agentId = text(entry, 'agentId')
        if (!agentId) return []
        const requested = text(entry, 'tab')
        return [{ agentId, tab: requested ? resolveTab(requested, AGENT_TAB_LABELS) : null, conversationId: text(entry, 'conversationId'), runId: text(entry, 'runId') }]
    })
}

const SHORTCUT_TOOL_NAMES = new Set(['show_agents', 'open_connector_setup'])

export function isAgentShortcutTool(toolName: string): boolean {
    return SHORTCUT_TOOL_NAMES.has(toolName)
}

export function shortcutPicks(toolName: string, input: unknown): AgentPick[] {
    if (toolName === 'open_connector_setup') return readAgentPicks({ agents: [{ ...(input && typeof input === 'object' ? input : {}), tab: 'services' }] })
    return readAgentPicks(input)
}

type ShortcutMessage = { role: string; parts: readonly { type: string }[] }
type ShortcutToolPart = { type: string; toolCallId: string; toolName?: string; state: string; input?: unknown }

export function planAgentShortcuts(messages: readonly ShortcutMessage[]): Map<string, AgentPick[] | null> {
    const plan = new Map<string, AgentPick[] | null>()
    for (const message of messages) {
        if (message.role !== 'assistant') continue
        let merged: AgentPick[] | null = null
        for (const part of message.parts) {
            if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') continue
            const toolPart = part as ShortcutToolPart
            const toolName = stripBridgePrefix(toolPart.toolName ?? toolPart.type.replace(/^tool-/, ''))
            if (!isAgentShortcutTool(toolName) || toolPart.state === 'output-error') continue
            const picks = shortcutPicks(toolName, toolPart.input)
            if (merged) {
                plan.set(toolPart.toolCallId, null)
            } else {
                merged = []
                plan.set(toolPart.toolCallId, merged)
            }
            for (const pick of picks) {
                const existing = merged.find(entry => entry.agentId === pick.agentId && entry.tab === pick.tab)
                if (!existing) merged.push({ ...pick })
                else if (!existing.conversationId && pick.conversationId) Object.assign(existing, { conversationId: pick.conversationId, runId: pick.runId })
            }
        }
    }
    return plan
}
