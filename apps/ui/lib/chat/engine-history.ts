import type { EngineMessage } from '@/lib/engine/types'
import { attachmentDisplayName, parseAttachments } from '@/lib/chat/attachments-marker'
import { parseInstallMessage } from '@/lib/chat/install-marker'
import { parseScheduledRun } from '@/lib/schedules/scheduled-run'
import { encodePeaks } from '@/lib/voice/peaks'
import { parseVoiceMessage } from '@/lib/voice/marker'
import { hitlKindOf } from '@/lib/chat-hitl'
import { isContextPart, visibleText, billedMicrosOf, capabilityOfCall, isPaidDataTool, paidCallReceipt, stripBridgePrefix, type ConversationAttachment, type ConversationMessage, type ConversationMessageMetadata } from '@rerun/contracts'
import { randomUuid } from '@rerun/db/helpers'

type TextPart = { type: 'text'; text: string }
type ToolInvocationPart = {
    type: `tool-${string}`
    toolCallId: string
    toolName: string
    state: 'input-available' | 'output-available'
    input: unknown
    output?: unknown
}
type UIMessagePart = TextPart | ToolInvocationPart
export type HistoryMessage = { id: string; role: 'user' | 'assistant'; parts: UIMessagePart[]; metadata?: { authorId?: string; createdAt?: string } }

function safeParse(json: string | null | undefined): unknown {
    if (!json) return null
    try {
        return JSON.parse(json)
    } catch {
        return json
    }
}

// A user row holds the words typed and, after them, the context the engine added for the model: the
// memories it recalled and the time of the turn. Only the words are shown.
function extractText(content: unknown): string {
    if (content && typeof content === 'object' && !Array.isArray(content) && typeof (content as { text?: unknown }).text === 'string') {
        return (content as { text: string }).text
    }
    return visibleText(content, '')
}

// rerun-engine persists AI-SDK message content as JSON in `contentJson`
// (and tool calls in `toolCallsJson`). Re-hydrate to UI message parts.
export function transformEngineMessages(messages: EngineMessage[]): HistoryMessage[] {
    const toolResults = new Map<string, unknown>()
    const recordResult = (part: unknown) => {
        const p = part as { type?: string; toolCallId?: string; output?: unknown; result?: unknown }
        if (p?.toolCallId && (p.type === 'tool-result' || p.output !== undefined || p.result !== undefined)) {
            toolResults.set(p.toolCallId, p.output ?? p.result ?? p)
        }
    }
    for (const m of messages) {
        const parsed = safeParse(m.contentJson)
        const arr = Array.isArray(parsed) ? parsed : [parsed]
        if (m.role === 'tool') {
            for (const part of arr) recordResult(part)
            continue
        }
        for (const part of arr) {
            if ((part as { type?: string })?.type === 'tool-result') recordResult(part)
        }
    }

    const result: HistoryMessage[] = []
    for (const m of messages) {
        if (m.role === 'tool') continue

        const content = safeParse(m.contentJson)

        if (m.role === 'user') {
            result.push({ id: `engine-${m.id}`, role: 'user', parts: [{ type: 'text', text: extractText(content) }], metadata: { createdAt: m.createdAt, ...(m.authorId && { authorId: m.authorId }) } })
            continue
        }

        // The row holds the turn in the order it was streamed: a text written after a tool call is
        // its own block, after that call, as the live transcript showed it.
        const parts: UIMessagePart[] = []
        const seen = new Set<string>()
        const pushCall = (call: unknown) => {
            const part = toolPartOf(call, toolResults)
            if (seen.has(part.toolCallId)) return
            seen.add(part.toolCallId)
            parts.push(part)
        }
        if (Array.isArray(content)) {
            for (const p of content) {
                const t = (p as { type?: string })?.type
                if (t === 'text' && !isContextPart(p)) {
                    const text = String((p as { text?: unknown }).text ?? '')
                    if (text) parts.push({ type: 'text', text })
                } else if (typeof t === 'string' && t.includes('tool') && t !== 'tool-result') {
                    pushCall(p)
                }
            }
        } else {
            const text = extractText(content)
            if (text) parts.push({ type: 'text', text })
        }
        const tcParsed = safeParse(m.toolCallsJson)
        if (Array.isArray(tcParsed)) for (const call of tcParsed) pushCall(call)

        if (parts.length === 0) continue
        // The message written for a card that went out bare lands in its own row, after the tool
        // row. Live, the AI SDK keeps the whole turn in one message, and both the pinned card and
        // the reply receipt look for the call in the last assistant message: fold it back in.
        const previous = result[result.length - 1]
        if (seen.size === 0 && previous && endsOnHitlCall(previous)) {
            previous.parts.push(...parts)
            continue
        }
        result.push({ id: `engine-${m.id}`, role: 'assistant', parts, metadata: { createdAt: m.createdAt } })
    }

    return result
}

type StoredToolCall = { toolCallId?: string; id?: string; toolName?: string; name?: string; function?: { name?: string }; input?: unknown; args?: unknown; arguments?: unknown }

function toolPartOf(call: unknown, toolResults: Map<string, unknown>): ToolInvocationPart {
    const c = call as StoredToolCall
    const toolCallId = c.toolCallId ?? c.id ?? randomUuid()
    const toolName = c.toolName ?? c.name ?? c.function?.name ?? 'tool'
    const rawInput = c.input ?? c.args ?? c.arguments ?? {}
    const input = typeof rawInput === 'string' ? safeParse(rawInput) : rawInput
    const output = toolResults.get(toolCallId)
    // An unresolved tool call (no matching tool-result) is still awaiting input, e.g. a paused
    // ask_user / request_approval. Keep it 'input-available' so the pinned block re-renders on reload.
    if (output !== undefined) return { type: `tool-${toolName}`, toolCallId, toolName, state: 'output-available', input, output }
    return { type: `tool-${toolName}`, toolCallId, toolName, state: 'input-available', input }
}

function endsOnHitlCall(message: HistoryMessage): boolean {
    const last = message.parts[message.parts.length - 1]
    return message.role === 'assistant' && last?.type !== 'text' && !!hitlKindOf(last?.toolName)
}

// The engine has no pagination, so a long research session comes back whole. Past this size a tool
// output is replaced by a preview: the app shows tool outputs collapsed and never needs them entire.
export const MAX_TOOL_OUTPUT_CHARS = 16_000

// Cards are what the app renders as the answer itself, so they always travel whole.
const UNTRIMMED_TOOLS = /(^|__)card_[a-z_]+$/

function trimOutput(toolName: string, input: unknown, output: unknown): unknown {
    if (UNTRIMMED_TOOLS.test(toolName)) return output
    const serialized = typeof output === 'string' ? output : JSON.stringify(output)
    if (serialized === undefined || serialized.length <= MAX_TOOL_OUTPUT_CHARS) return output
    const preview = { truncated: true, preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARS) }
    // A paid call's receipt adds up what it billed and where it bought it, so both outlive the trim.
    const bareName = stripBridgePrefix(toolName)
    if (isPaidDataTool(bareName)) {
        const capability = capabilityOfCall(bareName, input)
        const receipt = capability ? paidCallReceipt(capability, (input as { params?: Record<string, unknown> } | null)?.params, output) : null
        return { status: (output as { status?: unknown }).status, billedMicros: billedMicrosOf(output), ...(receipt ? { receipt } : {}), ...preview }
    }
    return preview
}

const MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    pdf: 'application/pdf',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
}

function attachmentOf(path: string): ConversationAttachment {
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    return { name: attachmentDisplayName(path), path, mediaType: MEDIA_TYPES[extension] ?? 'application/octet-stream' }
}

// The web parses the voice and attachment markers while rendering. The app gets them already
// lifted into metadata, so no client has to know the marker formats. An install and a scheduled run
// keep their bare guide or prompt as text, for an app older than their metadata.
function userMessageForApi(message: HistoryMessage): ConversationMessage {
    const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('')
    const createdAt = message.metadata?.createdAt
    const dated = createdAt ? { createdAt } : {}
    const install = parseInstallMessage(text)
    if (install) return { id: message.id, role: 'user', parts: [{ type: 'text', text: install.guide }], metadata: { ...dated, install: { agentName: install.agentName } } }
    const scheduledRun = parseScheduledRun(text)
    if (scheduledRun) return { id: message.id, role: 'user', parts: [{ type: 'text', text: scheduledRun.prompt }], metadata: { ...dated, scheduledRun: { slug: scheduledRun.slug, name: scheduledRun.name } } }

    const authorId = message.metadata?.authorId
    // A voice message sent with files carries the attachments marker after its voice marker.
    const attachments = parseAttachments(text)
    const voice = parseVoiceMessage(attachments?.text ?? text)
    if (!attachments && !voice) return { id: message.id, role: 'user', parts: message.parts, ...((authorId || createdAt) && { metadata: { ...dated, ...(authorId && { authorId }) } }) }

    const metadata: ConversationMessageMetadata = {
        ...dated,
        ...(authorId && { authorId }),
        ...(attachments && { attachments: attachments.paths.map(attachmentOf) }),
        ...(voice && { voice: { transcript: voice.transcript, src: voice.src, durationMs: voice.durationMs, peaks: encodePeaks(voice.peaks) } }),
    }
    const body = voice ? '' : attachments?.text
    return { id: message.id, role: 'user', parts: body ? [{ type: 'text', text: body }] : [], metadata }
}

export function toApiMessages(messages: HistoryMessage[]): ConversationMessage[] {
    return messages.map(message => {
        if (message.role === 'user') return userMessageForApi(message)
        return {
            id: message.id,
            role: 'assistant',
            parts: message.parts.map(part => (part.type !== 'text' && part.output !== undefined ? { ...part, output: trimOutput(part.toolName, part.input, part.output) } : part)),
            ...(message.metadata?.createdAt && { metadata: { createdAt: message.metadata.createdAt } }),
        }
    })
}
