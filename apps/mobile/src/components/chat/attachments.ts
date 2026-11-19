import { MAX_UPLOAD_FILE_BYTES } from '@moldwright/contracts'
import type { FileUIPart } from 'ai'

import { uploadChatFile } from '@/api/uploads'

export const MAX_ATTACHMENTS = 5

export type ComposerAttachment = { uri: string; name: string; mimeType: string; size?: number }

type Caller = { accessToken: string; workspaceId: number }

export const isImage = (attachment: { mimeType: string }) => attachment.mimeType.startsWith('image/')

export function imageAttachment(uri: string, index: number): ComposerAttachment {
    return { uri, name: uri.split('/').pop() || `photo-${index + 1}.jpg`, mimeType: 'image/jpeg' }
}

export function fitAttachments(current: ComposerAttachment[], added: ComposerAttachment[]): { attachments: ComposerAttachment[]; tooBig: ComposerAttachment[]; noRoom: ComposerAttachment[] } {
    const tooBig = added.filter(attachment => (attachment.size ?? 0) > MAX_UPLOAD_FILE_BYTES)
    const fitting = added.filter(attachment => !tooBig.includes(attachment) && !current.some(existing => existing.uri === attachment.uri))
    const room = Math.max(0, MAX_ATTACHMENTS - current.length)
    return { attachments: [...current, ...fitting.slice(0, room)], tooBig, noRoom: fitting.slice(room) }
}

export async function uploadAttachments(caller: Caller, agentId: string, attachments: ComposerAttachment[]): Promise<{ paths: string[]; files: FileUIPart[] }> {
    const paths = await Promise.all(attachments.map(attachment => uploadChatFile(caller, agentId, attachment.uri, attachment.name)))
    const files = attachments.map(attachment => ({ type: 'file' as const, mediaType: attachment.mimeType, filename: attachment.name, url: attachment.uri }))
    return { paths, files }
}
