const BLOCK = /\n*\[Attachments added to your workspace: ([^\]\n]+)\]\s*$/

const SEPARATOR = ', '

export const CHAT_ATTACHMENTS_DIR = 'chat-uploads'

const UNIQUE_PREFIX = /^[0-9a-z]{8,9}-[A-Za-z0-9_-]{6}-/

export function uniqueAttachmentName(fileName: string, token: string): string {
    return `${Date.now().toString(36)}-${token}-${fileName}`
}

export function buildAttachmentsRef(paths: readonly string[]): string {
    return `[Attachments added to your workspace: ${paths.join(SEPARATOR)}]`
}

export function appendAttachmentsRef(text: string, ref: string): string {
    const trimmed = text.trim()
    return trimmed ? `${trimmed}\n\n${ref}` : ref
}

export function stripAttachmentsRef(text: string): string {
    return text.replace(BLOCK, '').trim()
}

export function parseAttachments(text: string): { text: string; paths: string[] } | null {
    const match = BLOCK.exec(text)
    if (!match) return null

    const paths = match[1]
        .split(SEPARATOR)
        .map(path => path.trim())
        .filter(Boolean)
    if (paths.length === 0) return null

    return { text: text.slice(0, match.index).trim(), paths }
}

export function attachmentDisplayName(path: string): string {
    const name = path.split('/').pop() ?? path
    return name.replace(UNIQUE_PREFIX, '') || name
}
