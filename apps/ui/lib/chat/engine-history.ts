import type { EngineMessage } from '@/lib/engine/types'
import { attachmentDisplayName, parseAttachments } from '@/lib/chat/attachments-marker'
import { parseInstallMessage } from '@/lib/chat/install-marker'
import { parseScheduledRun } from '@/lib/schedules/scheduled-run'
import { encodePeaks } from '@/lib/voice/peaks'
import { parseVoiceMessage } from '@/lib/voice/marker'
import { hitlKindOf } from '@/lib/chat-hitl'
import { isContextPart, visibleText, billedMicrosOf, capabilityOfCall, isPaidDataTool, paidCallReceipt, stripBridgePrefix, withHitlVersion, type ConversationAttachment, type ConversationMessage, type ConversationMessageMetadata } from '@rerun/contracts'
import { randomUuid } from '@/lib/random-uuid'

type TextPart = { type: 'text'; text: string }
type ToolInvocationPart = {
    type: `tool-${string}`
    toolCallId: string
    toolName: string
    state: 'input-available' | 'output-available' | 'output-error'
    input: unknown
    output?: unknown
    errorText?: string
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

function extractText(content: unknown): string {
    if (content && typeof content === 'object' && !Array.isArray(content) && typeof (content as { text?: unknown }).text === 'string') {
        return (content as { text: string }).text
    }
    return visibleText(content, '')
}

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
        const previous = result[result.length - 1]
        if (seen.size === 0 && previous && endsOnHitlCall(previous)) {
            previous.parts.push(...parts)
            continue
        }
        result.push({ id: `engine-${m.id}`, role: 'assistant', parts, metadata: { createdAt: m.createdAt } })
    }

    return result
}

function storedToolError(output: unknown): string | null {
    const envelope = output as { type?: unknown; value?: unknown } | null
    if (envelope?.type !== 'error-json' && envelope?.type !== 'error-text') return null
    return typeof envelope.value === 'string' ? envelope.value : JSON.stringify(envelope.value)
}

type StoredToolCall = { toolCallId?: string; id?: string; toolName?: string; name?: string; function?: { name?: string }; input?: unknown; args?: unknown; arguments?: unknown }

function toolPartOf(call: unknown, toolResults: Map<string, unknown>): ToolInvocationPart {
    const c = call as StoredToolCall
    const toolCallId = c.toolCallId ?? c.id ?? randomUuid()
    const toolName = c.toolName ?? c.name ?? c.function?.name ?? 'tool'
    const rawInput = c.input ?? c.args ?? c.arguments ?? {}
    const input = withHitlVersion(toolName, typeof rawInput === 'string' ? safeParse(rawInput) : rawInput)
    const output = toolResults.get(toolCallId)
    const errorText = storedToolError(output)
    if (errorText !== null) return { type: `tool-${toolName}`, toolCallId, toolName, state: 'output-error', input, errorText }
    if (output !== undefined) return { type: `tool-${toolName}`, toolCallId, toolName, state: 'output-available', input, output }
    return { type: `tool-${toolName}`, toolCallId, toolName, state: 'input-available', input }
}

function endsOnHitlCall(message: HistoryMessage): boolean {
    const last = message.parts[message.parts.length - 1]
    return message.role === 'assistant' && last?.type !== 'text' && !!hitlKindOf(last?.toolName)
}

export const MAX_TOOL_OUTPUT_CHARS = 16_000

const UNTRIMMED_TOOLS = /(^|__)card_[a-z_]+$/

function trimOutput(toolName: string, input: unknown, output: unknown): unknown {
    if (UNTRIMMED_TOOLS.test(toolName)) return output
    const serialized = typeof output === 'string' ? output : JSON.stringify(output)
    if (serialized === undefined || serialized.length <= MAX_TOOL_OUTPUT_CHARS) return output
    const preview = { truncated: true, preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARS) }
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

function userMessageForApi(message: HistoryMessage): ConversationMessage {
    const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('')
    const createdAt = message.metadata?.createdAt
    const dated = createdAt ? { createdAt } : {}
    const install = parseInstallMessage(text)
    if (install) return { id: message.id, role: 'user', parts: [{ type: 'text', text: install.guide }], metadata: { ...dated, install: { agentName: install.agentName } } }
    const scheduledRun = parseScheduledRun(text)
    if (scheduledRun) return { id: message.id, role: 'user', parts: [{ type: 'text', text: scheduledRun.prompt }], metadata: { ...dated, scheduledRun: { slug: scheduledRun.slug, name: scheduledRun.name } } }

    const authorId = message.metadata?.authorId
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
