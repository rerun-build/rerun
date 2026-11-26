import { attachmentDisplayName, parseAttachments } from './chat-attachments.js'
import { parseQuote, quotePreview, stripQuote } from './chat-quote.js'
import { stripVoiceMarker } from './voice.js'

/**
 * A message the user wrote while a run was still holding the conversation. It waits in the
 * composer until the run ends, then leaves on its own.
 *
 * `text` is the finished message, attachments marker included, exactly what would have been sent.
 * `behindRunId` is the run that was in flight when it was queued: a reload only keeps the message
 * waiting if that same run is still going, so a tab reopened days later never fires it off.
 */
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

/** What the pill shows: the prose without its markers, and the display names of the files. */
export function queuedPreview(text: string): { text: string; attachments: string[] } {
    const quoted = parseQuote(text)
    if (quoted && !quoted.text.trim()) return { text: quotePreview(quoted.quote.text), attachments: [] }
    const attachments = parseAttachments(stripQuote(text))
    return {
        text: stripVoiceMarker(attachments?.text ?? stripQuote(text)),
        attachments: attachments?.paths.map(attachmentDisplayName) ?? [],
    }
}

export function shouldKeepQueued(queued: QueuedMessage, activeRunId: string | null): boolean {
    return queued.behindRunId !== null && queued.behindRunId === activeRunId
}

/** Whether the conversation is free enough for the waiting message to leave. */
export function shouldFlush(input: { queued: QueuedMessage | null; busy: boolean; uploading: boolean; status: string; hasError: boolean }): boolean {
    if (!input.queued) return false
    // `status` covers this tab's own stream, `busy` covers a run held elsewhere (session status,
    // reconnection). A run that ended on an error is left alone: sending again would burn the same
    // limit and bury the notice explaining why.
    if (input.busy || input.uploading || input.hasError) return false
    return input.status === 'ready'
}
