import { createHmac, timingSafeEqual } from 'node:crypto'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { site } from '@/lib/site'
import { ATTACHMENT_PATH, ATTACHMENT_REF_KEYS, downloadAttachment, type AttachmentRef } from './linkup/client'
import type { LinkupAttachment } from './linkup/envelope'

const LINKUP_HOST = 'api.linkupapi.com'

export const ATTACHMENT_URL_TTL_MS = 24 * 60 * 60_000

export const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024

export function parseAttachmentRef(input: Record<string, unknown>): AttachmentRef | null {
    const ref: AttachmentRef = {}
    const given = typeof input.download_url === 'string' ? input.download_url.trim() : ''
    if (given) {
        let url: URL
        try {
            url = new URL(given, `https://${LINKUP_HOST}`)
        } catch {
            return null
        }
        if (url.hostname !== LINKUP_HOST || url.pathname !== ATTACHMENT_PATH) return null
        for (const key of ATTACHMENT_REF_KEYS) {
            const value = url.searchParams.get(key)
            if (value) ref[key] = value
        }
    }
    for (const key of ATTACHMENT_REF_KEYS) {
        const value = input[key]
        if (typeof value === 'string' && value.trim()) ref[key] = value.trim()
    }
    return ref.message_id || ref.asset_urn || ref.attachment_id ? ref : null
}

type AttachmentTicket = { c: string; r: AttachmentRef; exp: number; t?: string }

function urlSecret(): string | null {
    return process.env.APP_ATTACHMENT_URL_SECRET || null
}

function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function mintAttachmentTicket(ticket: AttachmentTicket, secret: string): string {
    const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
    return `${payload}.${sign(payload, secret)}`
}

export function readAttachmentTicket(token: string, secret: string, now: number = Date.now()): AttachmentTicket | null {
    const [payload, signature, ...rest] = token.split('.')
    if (!payload || !signature || rest.length > 0) return null
    const expected = Buffer.from(sign(payload, secret))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    try {
        const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AttachmentTicket
        if (typeof ticket.c !== 'string' || typeof ticket.exp !== 'number' || !ticket.r || ticket.exp < now) return null
        return ticket
    } catch {
        return null
    }
}

export function readAttachmentTicketFromEnv(token: string): AttachmentTicket | null {
    const secret = urlSecret()
    return secret ? readAttachmentTicket(token, secret) : null
}

export function attachmentUrl(connectionId: string, ref: AttachmentRef, file: { name: string; mimeType: string | null }, now: number = Date.now()): { url: string; expiresAt: string } | null {
    const secret = urlSecret()
    if (!secret) return null
    const exp = now + ATTACHMENT_URL_TTL_MS
    const token = mintAttachmentTicket({ c: connectionId, r: ref, exp, ...(file.mimeType ? { t: file.mimeType } : {}) }, secret)
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? site.url).replace(/\/$/, '')
    return { url: `${base}/api/public/attachments/${token}/${encodeURIComponent(file.name)}`, expiresAt: new Date(exp).toISOString() }
}

const EXTENSION_BY_MIME: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

const TRANSCRIPTION_FORMAT_BY_EXTENSION: Record<string, string> = { ogg: 'ogg', oga: 'ogg', opus: 'ogg', m4a: 'm4a', mp4: 'm4a', aac: 'm4a', mp3: 'mp3', wav: 'wav', webm: 'webm', flac: 'flac' }

export function baseMime(mimeType: string | null | undefined): string | null {
    const base = mimeType?.split(';')[0]?.trim().toLowerCase()
    return base || null
}

function extensionOfName(name: string | null | undefined): string | null {
    const match = /\.([a-z0-9]{1,5})$/i.exec(name ?? '')
    return match ? match[1].toLowerCase() : null
}

export function extensionOf(mimeType: string | null | undefined, name?: string | null): string {
    return extensionOfName(name) ?? EXTENSION_BY_MIME[baseMime(mimeType) ?? ''] ?? 'bin'
}

export function audioFormatOf(mimeType: string | null | undefined, name?: string | null): string | null {
    const mime = baseMime(mimeType)
    if (mime && !mime.startsWith('audio/') && mime !== 'video/mp4' && mime !== 'application/octet-stream') return null
    const fromMime = mime ? EXTENSION_BY_MIME[mime] : undefined
    const extension = (mime?.startsWith('audio/') ? fromMime : null) ?? extensionOfName(name) ?? fromMime
    return extension ? (TRANSCRIPTION_FORMAT_BY_EXTENSION[extension] ?? null) : null
}

export function isAudioAttachment(attachment: { type?: string; mime_type?: string }): boolean {
    return attachment.type === 'audio' || (baseMime(attachment.mime_type)?.startsWith('audio/') ?? false)
}

export function safeFileName(name: string | null | undefined, fallbackStem: string, extension: string): string {
    const cleaned = (name ?? '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.\s-]+/, '')
        .slice(-120)
    if (cleaned && extensionOfName(cleaned)) return cleaned
    const stem = cleaned || fallbackStem.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 60) || 'attachment'
    return `${stem}.${extension}`
}

export async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
            await reader.cancel().catch(() => {})
            return null
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks)
}

export type Transcription = { transcript: string } | { transcriptError: string }

export async function transcribeStream(stream: ReadableStream<Uint8Array>, format: string, signal?: AbortSignal): Promise<Transcription> {
    try {
        const audio = await readCapped(stream, TRANSCRIBE_MAX_BYTES)
        if (!audio) return { transcriptError: `The audio is over ${TRANSCRIBE_MAX_BYTES / 1024 / 1024} MB, too long to transcribe.` }
        if (audio.byteLength === 0) return { transcriptError: 'The audio file is empty.' }
        return { transcript: await transcribeAudio(audio, format, signal) }
    } catch (err) {
        return { transcriptError: err instanceof Error && err.name !== 'TimeoutError' && err.name !== 'AbortError' ? err.message : 'The transcription took too long.' }
    }
}

export type AttachmentSummary = {
    type: string
    name: string
    mimeType: string | null
    byteSize: number | null
    durationMs: number | null
    downloadUrl: string | null
    url: string | null
    expiresAt: string | null
    transcript?: string | null
    transcriptError?: string
}

export function attachmentRefOf(attachment: LinkupAttachment, base: AttachmentRef): AttachmentRef | null {
    return parseAttachmentRef({ ...base, download_url: attachment.download_url, message_id: attachment.message_id ?? base.message_id, asset_urn: attachment.asset_urn, attachment_id: attachment.attachment_id })
}

function summaryOf(attachment: LinkupAttachment, ref: AttachmentRef | null, connectionId: string, index: number): AttachmentSummary {
    const mimeType = baseMime(attachment.mime_type)
    const name = safeFileName(attachment.name ?? attachment.filename, `${attachment.type ?? 'attachment'}-${ref?.message_id ?? ref?.asset_urn ?? index + 1}`, extensionOf(mimeType, attachment.name ?? attachment.filename))
    const link = ref ? attachmentUrl(connectionId, ref, { name, mimeType }) : null
    const downloadUrl = ref ? `${ATTACHMENT_PATH}?${new URLSearchParams(ref as Record<string, string>)}` : null
    return {
        type: attachment.type ?? 'file',
        name,
        mimeType,
        byteSize: attachment.byte_size ?? attachment.size ?? null,
        durationMs: attachment.duration_ms ?? null,
        downloadUrl,
        url: link?.url ?? null,
        expiresAt: link?.expiresAt ?? null,
    }
}

export async function summarizeAttachments(input: { accountId: string; connectionId: string; attachments: LinkupAttachment[]; base: AttachmentRef; budgetMs: number }): Promise<AttachmentSummary[]> {
    const signal = AbortSignal.timeout(input.budgetMs)
    return Promise.all(
        input.attachments.map(async (attachment, index) => {
            const ref = attachmentRefOf(attachment, input.base)
            const summary = summaryOf(attachment, ref, input.connectionId, index)
            if (!ref || !isAudioAttachment(attachment)) return summary
            try {
                const file = await downloadAttachment(input.accountId, ref, signal)
                const format = audioFormatOf(file.contentType, summary.name) ?? audioFormatOf(summary.mimeType, summary.name)
                if (!format) {
                    await file.body.cancel().catch(() => {})
                    return { ...summary, transcript: null, transcriptError: 'This audio format cannot be transcribed.' }
                }
                const result = await transcribeStream(file.body, format, signal)
                return 'transcript' in result ? { ...summary, transcript: result.transcript } : { ...summary, transcript: null, ...result }
            } catch (err) {
                const timedOut = signal.aborted || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
                return { ...summary, transcript: null, transcriptError: timedOut ? 'The transcription took too long.' : 'The audio could not be fetched.' }
            }
        }),
    )
}
