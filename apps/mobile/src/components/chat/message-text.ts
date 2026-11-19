import { attachmentDisplayName, decodePeaks, messageText, parseAttachments, parseVoiceMessage, stripAttachmentsRef, stripVoiceMarker, type VoiceMessage } from '@moldwright/contracts'
import type { UIMessage } from 'ai'

export function userTextOf(message: UIMessage): string {
    return stripAttachmentsRef(stripVoiceMarker(messageText(message))).trim()
}

export function attachmentsOf(message: UIMessage): { name: string; path: string }[] {
    const stored = (message.metadata as { attachments?: { name: string; path: string }[] } | undefined)?.attachments
    if (stored?.length) return stored.map(({ name, path }) => ({ name, path }))
    return parseAttachments(messageText(message))?.paths.map(path => ({ name: attachmentDisplayName(path), path })) ?? []
}

type StoredVoice = { transcript: string; src: string; durationMs: number; peaks?: string }

export function voiceOf(message: UIMessage): VoiceMessage | null {
    const stored = (message.metadata as { voice?: StoredVoice } | undefined)?.voice
    if (stored) return { transcript: stored.transcript, src: stored.src, durationMs: stored.durationMs, peaks: decodePeaks(stored.peaks ?? '') }
    const text = messageText(message)
    return parseVoiceMessage(parseAttachments(text)?.text ?? text)
}
