import 'server-only'

import type { UIMessage } from 'ai'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { attachmentDisplayName, parseAttachments } from '@/lib/chat/attachments-marker'
import { fileExtension, filePreviewKind } from '@/lib/files/preview'
import { downloadPrivateFile } from '@/lib/storage/private'
import { TEXT_FILE_PAGE_CHARS } from '@rerun/contracts'

import { FOREMAN_FILES_BUCKET, foremanFileKey } from './files'

type FilesContext = Pick<WorkspaceContext, 'userId' | 'workspace' | 'supabase'>
type Part = UIMessage['parts'][number]

const IMAGE_MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
}

export async function withInlineAttachments(messages: UIMessage[], ctx: FilesContext, sessionId: string): Promise<UIMessage[]> {
    return Promise.all(
        messages.map(async message => {
            if (message.role !== 'user') return message
            const last = message.parts.findLastIndex(part => part.type === 'text')
            if (last < 0) return message
            const attachments = parseAttachments((message.parts[last] as { text: string }).text)
            if (!attachments) return message

            const inlined = (await Promise.all(attachments.paths.map(path => inlineAttachment(ctx, sessionId, path)))).filter(part => part !== null)
            if (inlined.length === 0) return message
            return { ...message, parts: [...message.parts.slice(0, last + 1), ...inlined, ...message.parts.slice(last + 1)] }
        })
    )
}

async function inlineAttachment(ctx: FilesContext, sessionId: string, path: string): Promise<Part | null> {
    const name = attachmentDisplayName(path)
    const ext = fileExtension(path)
    const mediaType = IMAGE_MEDIA_TYPES[ext] ?? (ext === 'pdf' ? 'application/pdf' : null)
    const readsAsText = ext === 'svg' || filePreviewKind(path) === 'text'
    if (!mediaType && !readsAsText) return null

    const blob = await downloadPrivateFile(ctx.supabase, FOREMAN_FILES_BUCKET, foremanFileKey(ctx, sessionId, path)).catch(() => null)
    if (!blob) return null

    if (mediaType) {
        const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
        return { type: 'file', mediaType, filename: name, url: `data:${mediaType};base64,${base64}` }
    }

    const text = await blob.text()
    if (text.includes('\u0000')) return null
    const truncated = text.length > TEXT_FILE_PAGE_CHARS
    return { type: 'text', text: `<file name="${name}"${truncated ? ' truncated="true"' : ''}>\n${text.slice(0, TEXT_FILE_PAGE_CHARS)}\n</file>` }
}
