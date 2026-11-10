import { attachmentDisplayName, decodePeaks, messageText, parseAttachments, parseVoiceMessage, stripAttachmentsRef, stripVoiceMarker, type VoiceMessage } from '@rerun/contracts'
import type { UIMessage } from 'ai'

// What the person sent, without the markers the hub reads: attached paths and the voice recording.
export function userTextOf(message: UIMessage): string {
    return stripAttachmentsRef(stripVoiceMarker(messageText(message))).trim()
}

// The files a message carried: from the transcript's metadata, or from the paths its text names.
export function attachmentsOf(message: UIMessage): { name: string; path: string }[] {
    const stored = (message.metadata as { attachments?: { name: string; path: string }[] } | undefined)?.attachments
    if (stored?.length) return stored.map(({ name, path }) => ({ name, path }))
    return parseAttachments(messageText(message))?.paths.map(path => ({ name: attachmentDisplayName(path), path })) ?? []
}

type StoredVoice = { transcript: string; src: string; durationMs: number; peaks?: string }

// The recording a message is: from the transcript's metadata once read back, or from the marker in
// its text while it is the message just sent. Its attachments marker follows the voice one.
export function voiceOf(message: UIMessage): VoiceMessage | null {
    const stored = (message.metadata as { voice?: StoredVoice } | undefined)?.voice
    if (stored) return { transcript: stored.transcript, src: stored.src, durationMs: stored.durationMs, peaks: decodePeaks(stored.peaks ?? '') }
    const text = messageText(message)
    return parseVoiceMessage(parseAttachments(text)?.text ?? text)
}
