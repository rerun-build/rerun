import { attachmentDisplayName, parseAttachments } from './chat-attachments.js'
import { stripVoiceMarker } from './voice.js'

export type QueuedMessage = {
    id: string
    text: string
    createdAt: number
    behindRunId: string | null
}

export function parseQueued(raw: string | null): QueuedMessage | null {
    if (!raw) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }

    if (typeof parsed !== 'object' || parsed === null) return null
    const { id, text, createdAt, behindRunId } = parsed as Record<string, unknown>
    if (typeof id !== 'string' || !id) return null
    if (typeof text !== 'string' || !text.trim()) return null
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
    if (behindRunId !== null && typeof behindRunId !== 'string') return null

    return { id, text, createdAt, behindRunId }
}

export function queuedPreview(text: string): { text: string; attachments: string[] } {
    const attachments = parseAttachments(text)
    return {
        text: stripVoiceMarker(attachments?.text ?? text),
        attachments: attachments?.paths.map(attachmentDisplayName) ?? [],
    }
}

export function shouldKeepQueued(queued: QueuedMessage, activeRunId: string | null): boolean {
    return queued.behindRunId !== null && queued.behindRunId === activeRunId
}

export function shouldFlush(input: { queued: QueuedMessage | null; busy: boolean; uploading: boolean; status: string; hasError: boolean }): boolean {
    if (!input.queued) return false
    if (input.busy || input.uploading || input.hasError) return false
    return input.status === 'ready'
}
