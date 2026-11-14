import { brainChangeOf, fileCardSchema, mcpRegisterCardOf, parseHubOutput, stripBridgePrefix, tableCardSchema, type BrainChange, type FileCard, type McpRegisterCard, type TableCard } from '@rerun/contracts'

type ToolPart = { type: string; toolName?: string; state?: string; output?: unknown }

export type ChatCard = { kind: 'table'; card: TableCard } | { kind: 'file'; card: FileCard }

const CARD_TOOLS = { card_table: tableCardSchema, card_file: fileCardSchema, image_generation: fileCardSchema } as const

export function cardOf(part: ToolPart): ChatCard | null {
    const name = stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
    if (part.state !== 'output-available' || !(name in CARD_TOOLS)) return null
    const parsed = CARD_TOOLS[name as keyof typeof CARD_TOOLS].safeParse(parseHubOutput(part.output))
    if (!parsed.success) return null
    return name === 'card_table' ? { kind: 'table', card: parsed.data as TableCard } : { kind: 'file', card: parsed.data as FileCard }
}

export type SizeUnit = 'b' | 'kb' | 'mb'

export function sizeParts(size: number): { unit: SizeUnit; value: number; fractionDigits: number } {
    if (size < 1024) return { unit: 'b', value: size, fractionDigits: 0 }
    if (size < 1024 * 1024) return { unit: 'kb', value: Math.round(size / 1024), fractionDigits: 0 }
    return { unit: 'mb', value: size / (1024 * 1024), fractionDigits: 1 }
}

const HASHED_TONES = ['brand', 'cyan', 'green', 'orange', 'yellow', 'neutral'] as const

export function toneOf(value: string, tones?: Record<string, string>): string {
    const explicit = tones?.[value]
    if (explicit) return explicit
    let hash = 0
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return HASHED_TONES[Math.abs(hash) % HASHED_TONES.length]
}

export type EventCard =
    | { kind: 'notification'; message: string }
    | { kind: 'setup'; summary: string; schedules: number; triggers: number }
    | { kind: 'brain-proposal'; title: string; mode: 'create' | 'edit' }
    | { kind: 'brain-change'; change: BrainChange }

type EventPart = ToolPart & { input?: unknown }

export function eventCardOf(part: EventPart): EventCard | null {
    if (part.state !== 'output-available') return null
    const name = stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
    const input = (part.input ?? {}) as Record<string, unknown>
    if (name === 'notify_user') {
        const undelivered = JSON.stringify(part.output ?? '').includes('Notification not delivered')
        return typeof input.message === 'string' && input.message.trim() && !undelivered ? { kind: 'notification', message: input.message } : null
    }
    if (name === 'install_complete') {
        const out = parseHubOutput<{ status?: string; summary?: string; activated?: { schedules?: string[]; triggers?: string[] } }>(part.output)
        return out?.status === 'complete' ? { kind: 'setup', summary: out.summary ?? '', schedules: out.activated?.schedules?.length ?? 0, triggers: out.activated?.triggers?.length ?? 0 } : null
    }
    if (name === 'brain_propose') {
        const out = parseHubOutput<{ status?: string; title?: string }>(part.output)
        return (out?.status === 'proposed' || out?.status === 'updated') && out.title ? { kind: 'brain-proposal', title: out.title, mode: input.baseHash ? 'edit' : 'create' } : null
    }
    const change = brainChangeOf(name, part.output)
    return change ? { kind: 'brain-change', change } : null
}

export type ConnectCard = { kind: 'service-installed'; name: string; toolNames: string[] } | { kind: 'service-needs-auth'; slug: string; name: string } | { kind: 'mcp-server'; card: McpRegisterCard }

export function connectCardOf(part: EventPart): ConnectCard | null {
    if (part.state !== 'output-available') return null
    const name = stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
    if (name === 'rerun_hub_service_install') {
        const out = parseHubOutput<{ status?: string; slug?: string; name?: string; toolNames?: string[] }>(part.output)
        if (out?.status === 'installed' && out.name) return { kind: 'service-installed', name: out.name, toolNames: out.toolNames ?? [] }
        if (out?.status === 'needs_auth' && out.slug && out.name) return { kind: 'service-needs-auth', slug: out.slug, name: out.name }
        return null
    }
    if (name === 'mcp_register' || name === 'mcp_login') {
        const card = mcpRegisterCardOf(name, part.input, part.output)
        return card ? { kind: 'mcp-server', card } : null
    }
    return null
}
