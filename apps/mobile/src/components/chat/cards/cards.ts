import { brainChangeOf, fileCardSchema, mcpRegisterCardOf, parseHubOutput, publishedAccessModeSchema, stripBridgePrefix, tableCardSchema, type BrainChange, type FileCard, type McpRegisterCard, type PublishedAccessMode, type TableCard } from '@rerun/contracts'

type ToolPart = { type: string; toolName?: string; state?: string; output?: unknown }

export type ChatCard = { kind: 'table'; card: TableCard } | { kind: 'file'; card: FileCard }

// A picture Codex generated on a ChatGPT plan comes back shaped like a file card.
const CARD_TOOLS = { card_table: tableCardSchema, card_file: fileCardSchema, image_generation: fileCardSchema } as const

// The card a tool call drew, once its output is in and parses; anything else stays a step.
export function cardOf(part: ToolPart): ChatCard | null {
    const name = stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
    if (part.state !== 'output-available' || !(name in CARD_TOOLS)) return null
    const parsed = CARD_TOOLS[name as keyof typeof CARD_TOOLS].safeParse(parseHubOutput(part.output))
    if (!parsed.success) return null
    return name === 'card_table' ? { kind: 'table', card: parsed.data as TableCard } : { kind: 'file', card: parsed.data as FileCard }
}

export type SizeUnit = 'b' | 'kb' | 'mb'

// A file's size as the web card rounds it: whole bytes and kilobytes, megabytes to one decimal.
export function sizeParts(size: number): { unit: SizeUnit; value: number; fractionDigits: number } {
    if (size < 1024) return { unit: 'b', value: size, fractionDigits: 0 }
    if (size < 1024 * 1024) return { unit: 'kb', value: Math.round(size / 1024), fractionDigits: 0 }
    return { unit: 'mb', value: size / (1024 * 1024), fractionDigits: 1 }
}

const HASHED_TONES = ['brand', 'cyan', 'green', 'orange', 'yellow', 'neutral'] as const

// The tone the agent gave a value, or a stable one hashed from it, as the web card picks it.
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

// What a coworker did that the person should see rather than a step: a notification it sent, a setup
// it finished, a change to the Brain. Anything unreadable stays a step.
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

// An app or a server the coworker just connected, as the web shows it. Browsing the catalog stays a
// step: only an actual install, or a server registered outside the catalog, is worth a card.
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

export type PublishCard = { slug: string; url: string; path: string; title: string; access: PublishedAccessMode; requestedAccess: 'public' | null }

// What a coworker published, as the tool output told it at the time. A call made before links had an
// access carries neither its title nor its access: it was public.
export function publishCardOf(part: ToolPart): PublishCard | null {
    if (part.state !== 'output-available') return null
    const name = stripBridgePrefix(part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''))
    if (name !== 'rerun_hub_publish_file') return null
    const out = parseHubOutput<{ status?: string; slug?: string; url?: string; path?: string; title?: string; access?: string; requestedAccess?: string | null }>(part.output)
    if (out?.status !== 'published' || !out.slug || !out.url) return null
    const access = publishedAccessModeSchema.safeParse(out.access ?? 'public')
    const path = out.path ?? ''
    return { slug: out.slug, url: out.url, path, title: out.title || path || out.slug, access: access.success ? access.data : 'public', requestedAccess: out.requestedAccess === 'public' ? 'public' : null }
}

type TranscriptMessage = { id: string; role: string; parts: ({ type: string; text?: string } & Partial<ToolPart>)[] }

// Where each published link is drawn: under the first text the coworker writes after publishing it, as
// the coworker says "the card below". A reloaded transcript splits a turn into one message per step,
// so the text can be in a later message of the same turn; a turn that writes nothing after keeps the
// card on its last message. A link published again keeps its slug: only its latest call is drawn.
export function publishCardsByMessage(messages: TranscriptMessage[]): Map<string, PublishCard[]> {
    const placed = new Map<string, PublishCard[]>()
    let waiting: PublishCard[] = []
    let lastAssistant: string | null = null
    const place = (messageId: string) => {
        if (waiting.length === 0) return
        placed.set(messageId, [...(placed.get(messageId) ?? []), ...waiting])
        waiting = []
    }
    const forget = (slug: string) => {
        waiting = waiting.filter(card => card.slug !== slug)
        for (const [messageId, cards] of placed) {
            const kept = cards.filter(card => card.slug !== slug)
            if (kept.length === cards.length) continue
            if (kept.length > 0) placed.set(messageId, kept)
            else placed.delete(messageId)
        }
    }
    for (const message of messages) {
        if (message.role !== 'assistant') {
            if (lastAssistant) place(lastAssistant)
            lastAssistant = null
            continue
        }
        lastAssistant = message.id
        for (const part of message.parts) {
            if (part.type === 'text' && part.text?.trim()) place(message.id)
            const card = part.type === 'text' ? null : publishCardOf(part as ToolPart)
            if (!card) continue
            forget(card.slug)
            waiting.push(card)
        }
    }
    if (lastAssistant) place(lastAssistant)
    return placed
}
