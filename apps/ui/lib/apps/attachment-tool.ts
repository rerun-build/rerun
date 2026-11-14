import { MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import * as engine from '@/lib/engine/client'
import { attachmentUrl, audioFormatOf, baseMime, extensionOf, parseAttachmentRef, safeFileName, transcribeStream, type Transcription } from './attachments'
import { downloadAttachment } from './linkup/client'
import { AppToolRefusal, type AppTool, type AppToolContext } from './tools'

// The one tool both apps share: a file somebody sent, made usable. The bytes are streamed once from
// Linkup, into the coworker's files and, for a voice note asked to be transcribed, to Whisper.

const TRANSCRIBE_TIMEOUT_MS = 60_000

function timestamp(now: Date): string {
    return now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

async function copyToFiles(context: AppToolContext, body: ReadableStream<Uint8Array>, name: string, size: number | null): Promise<{ path: string; size: number } | { fileError: string }> {
    if (size !== null && size > MAX_UPLOAD_FILE_BYTES) {
        await body.cancel().catch(() => {})
        return { fileError: `The file is over ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB, too large to copy into your files. Use the url.` }
    }
    try {
        const conn = await context.engine()
        if (!(await engine.supportsStreamedUploads(conn))) {
            await body.cancel().catch(() => {})
            return { fileError: 'Your machine is updating and cannot take the file yet. Use the url.' }
        }
        const result = await engine.uploadFileStream(conn, `/agents/${context.engineAgentId}/files`, { dir: `attachments/${context.slug}`, name: `${timestamp(new Date())}-${name}`, body, size })
        return { path: result.path, size: result.bytes }
    } catch (err) {
        await body.cancel().catch(() => {})
        console.warn(`[apps:${context.slug}] attachment copy failed`, err instanceof Error ? err.message : err)
        return { fileError: 'The file could not be copied into your files. Use the url.' }
    }
}

async function runDownload(context: AppToolContext, params: Record<string, unknown>): Promise<unknown> {
    const ref = parseAttachmentRef(params)
    if (!ref) throw new AppToolRefusal('Pass the download_url of the attachment exactly as the conversation or your wake payload gave it. Its `url` field is not a download link.')

    const file = await downloadAttachment(context.accountId, ref)
    const mimeType = baseMime(file.contentType)
    const name = safeFileName(file.filename ?? ref.filename, `attachment-${ref.message_id ?? ref.asset_urn ?? ref.attachment_id ?? ''}`, extensionOf(mimeType, file.filename ?? ref.filename))
    const link = attachmentUrl(context.connectionId, ref, { name, mimeType })

    const format = params.transcribe === true ? audioFormatOf(mimeType, name) : null
    const [toFiles, toTranscript] = format ? file.body.tee() : [file.body, null]
    const [copy, transcription] = await Promise.all([
        copyToFiles(context, toFiles, name, file.size),
        toTranscript && format ? transcribeStream(toTranscript, format, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)) : Promise.resolve<Transcription | null>(null),
    ])

    return {
        name,
        mimeType,
        size: file.size,
        url: link?.url ?? null,
        expiresAt: link?.expiresAt ?? null,
        ...copy,
        ...(transcription ?? {}),
        ...(params.transcribe === true && !format ? { transcriptError: 'Only a voice note or an audio file can be transcribed.' } : {}),
    }
}

export function attachmentTool<Q extends string>(quotaAction: Q): AppTool<Q, never> {
    return {
        name: 'download_attachment',
        description:
            'Get a file somebody sent in a conversation: a voice note, an image, a video, a document. Pass the attachment’s download_url, as the conversation or your wake payload gives it. You get a public https url that serves the file for 24 hours with no sign-in (hand it as is to any tool or API that takes a file URL), the path of a copy in your files, and with transcribe: true the words of a voice note.',
        inputSchema: {
            type: 'object',
            properties: {
                download_url: { type: 'string', description: 'The attachment’s download_url, e.g. /v2/messages/attachment?account_id=…&message_id=…' },
                message_id: { type: 'string', description: 'Instead of download_url: the id of the message carrying the file' },
                conversation_id: { type: 'string', description: 'With asset_urn, instead of download_url, for a LinkedIn file' },
                asset_urn: { type: 'string', description: 'With conversation_id or message_id, instead of download_url, for a LinkedIn file' },
                transcribe: { type: 'boolean', description: 'Also return the text of a voice note or audio file' },
            },
        },
        category: 'messages',
        action: 'download_attachment',
        quota: { action: quotaAction },
        run: runDownload,
    }
}
