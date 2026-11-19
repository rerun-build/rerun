import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { LinkupError, downloadAttachment } from '@/lib/apps/linkup/client'
import { ATTACHMENT_URL_TTL_MS, attachmentUrl, audioFormatOf, mintAttachmentTicket, parseAttachmentRef, readAttachmentTicket, readCapped, safeFileName, summarizeAttachments } from './attachments'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), downloadAttachment: vi.fn() }))
vi.mock('@/lib/ai/transcribe', () => ({ transcribeAudio: vi.fn() }))

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
            controller.close()
        },
    })
}

describe('parseAttachmentRef', () => {
    it('reads the relative download_url WhatsApp hands out, without its account', () => {
        expect(parseAttachmentRef({ download_url: '/v2/messages/attachment?account_id=someone-else&message_id=3EB0C1A2' })).toEqual({ message_id: '3EB0C1A2' })
    })

    it('reads the absolute one LinkedIn hands out', () => {
        const url = 'https://api.linkupapi.com/v2/messages/attachment?account_id=acc&conversation_id=urn%3Ali%3Amsg_conversation%3A(1%2C2)&asset_urn=urn%3Ali%3AdigitalmediaAsset%3AD4E'
        expect(parseAttachmentRef({ download_url: url })).toEqual({ conversation_id: 'urn:li:msg_conversation:(1,2)', asset_urn: 'urn:li:digitalmediaAsset:D4E' })
    })

    it('refuses any other host or path, and a link naming no file', () => {
        expect(parseAttachmentRef({ download_url: 'https://evil.example/v2/messages/attachment?message_id=1' })).toBeNull()
        expect(parseAttachmentRef({ download_url: 'https://media.licdn.com/dms/document/abc' })).toBeNull()
        expect(parseAttachmentRef({ download_url: '/v2/accounts?message_id=1' })).toBeNull()
        expect(parseAttachmentRef({ download_url: '/v2/messages/attachment?account_id=acc' })).toBeNull()
        expect(parseAttachmentRef({})).toBeNull()
    })

    it('takes the ids alone, and lets them complete the link', () => {
        expect(parseAttachmentRef({ message_id: ' 3EB0 ' })).toEqual({ message_id: '3EB0' })
        expect(parseAttachmentRef({ download_url: '/v2/messages/attachment?asset_urn=a', conversation_id: 'c' })).toEqual({ asset_urn: 'a', conversation_id: 'c' })
    })
})

describe('attachment tickets', () => {
    const ticket = { c: 'conn-1', r: { message_id: '3EB0' }, exp: 2_000_000, t: 'audio/ogg' }

    it('reads back what it signed until it expires', () => {
        const token = mintAttachmentTicket(ticket, 'secret')
        expect(readAttachmentTicket(token, 'secret', 1_000_000)).toEqual(ticket)
        expect(readAttachmentTicket(token, 'secret', 2_000_001)).toBeNull()
    })

    it('refuses a tampered ticket or another key', () => {
        const token = mintAttachmentTicket(ticket, 'secret')
        const [payload, signature] = token.split('.')
        const forged = Buffer.from(JSON.stringify({ ...ticket, c: 'conn-2' })).toString('base64url')
        expect(readAttachmentTicket(`${forged}.${signature}`, 'secret', 0)).toBeNull()
        expect(readAttachmentTicket(`${payload}.${signature}`, 'other', 0)).toBeNull()
        expect(readAttachmentTicket('garbage', 'secret', 0)).toBeNull()
    })
})

describe('attachmentUrl', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('ends with the file name and lives a day', () => {
        vi.stubEnv('APP_ATTACHMENT_URL_SECRET', 'secret')
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://moldwright.robagentic.tech/')
        const link = attachmentUrl('conn-1', { message_id: '3EB0' }, { name: 'voice note.ogg', mimeType: 'audio/ogg' }, 0)!
        expect(link.url).toMatch(/^https:\/\/app\.rerun\.build\/api\/public\/attachments\/[\w-]+\.[\w-]+\/voice%20note\.ogg$/)
        expect(link.expiresAt).toBe(new Date(ATTACHMENT_URL_TTL_MS).toISOString())
        const token = link.url.split('/')[6]
        expect(readAttachmentTicket(token, 'secret', 0)).toMatchObject({ c: 'conn-1', r: { message_id: '3EB0' }, t: 'audio/ogg' })
    })

    it('mints nothing without its secret', () => {
        vi.stubEnv('APP_ATTACHMENT_URL_SECRET', '')
        expect(attachmentUrl('conn-1', { message_id: '3EB0' }, { name: 'a.ogg', mimeType: null })).toBeNull()
    })
})

describe('formats and names', () => {
    it('knows which audio the transcription takes', () => {
        expect(audioFormatOf('audio/ogg; codecs=opus')).toBe('ogg')
        expect(audioFormatOf('audio/mp4')).toBe('m4a')
        expect(audioFormatOf('audio/mpeg')).toBe('mp3')
        expect(audioFormatOf('application/octet-stream', 'voice.opus')).toBe('ogg')
        expect(audioFormatOf(null, 'note.m4a')).toBe('m4a')
        expect(audioFormatOf('application/pdf', 'cv.pdf')).toBeNull()
        expect(audioFormatOf('image/jpeg')).toBeNull()
    })

    it('keeps a name the files and a URL both take', () => {
        expect(safeFileName('../../etc/passwd', 'x', 'bin')).toBe('etc-passwd.bin')
        expect(safeFileName('Devis 2026.pdf', 'x', 'pdf')).toBe('Devis 2026.pdf')
        expect(safeFileName(null, 'audio-3EB0C1A2', 'ogg')).toBe('audio-3EB0C1A2.ogg')
        expect(safeFileName(undefined, 'file-urn:li:digitalmediaAsset:D4E', 'pdf')).toBe('file-urnlidigitalmediaAssetD4E.pdf')
    })

    it('stops reading past its cap', async () => {
        await expect(readCapped(streamOf('abc', 'def'), 10)).resolves.toEqual(Buffer.from('abcdef'))
        await expect(readCapped(streamOf('abc', 'def'), 5)).resolves.toBeNull()
    })
})

describe('summarizeAttachments', () => {
    beforeEach(() => {
        vi.stubEnv('APP_ATTACHMENT_URL_SECRET', 'secret')
        vi.mocked(downloadAttachment).mockReset()
        vi.mocked(transcribeAudio).mockReset()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    const voice = { type: 'audio', mime_type: 'audio/ogg; codecs=opus', byte_size: 41_000, duration_ms: 12_000, download_url: '/v2/messages/attachment?account_id=acc&message_id=3EB0' }

    it('hands a voice note with its words and a link', async () => {
        vi.mocked(downloadAttachment).mockResolvedValue({ body: streamOf('opus'), contentType: 'audio/ogg; codecs=opus', filename: null, size: 4 })
        vi.mocked(transcribeAudio).mockResolvedValue('On se voit demain à 10h')
        const [summary] = await summarizeAttachments({ accountId: 'acc', connectionId: 'conn-1', attachments: [voice], base: {}, budgetMs: 1_000 })
        expect(downloadAttachment).toHaveBeenCalledWith('acc', { message_id: '3EB0' }, expect.any(AbortSignal))
        expect(transcribeAudio).toHaveBeenCalledWith(Buffer.from('opus'), 'ogg', expect.any(AbortSignal))
        expect(summary).toMatchObject({
            type: 'audio',
            name: 'audio-3EB0.ogg',
            mimeType: 'audio/ogg',
            byteSize: 41_000,
            durationMs: 12_000,
            downloadUrl: '/v2/messages/attachment?message_id=3EB0',
            transcript: 'On se voit demain à 10h',
        })
        expect(summary.url).toMatch(/\/api\/public\/attachments\/.+\/audio-3EB0\.ogg$/)
    })

    it('names a WhatsApp file by its message when the attachment does not', async () => {
        const [summary] = await summarizeAttachments({ accountId: 'acc', connectionId: 'conn-1', attachments: [{ type: 'image', mime_type: 'image/jpeg' }], base: { message_id: 'M1' }, budgetMs: 1_000 })
        expect(downloadAttachment).not.toHaveBeenCalled()
        expect(summary).toMatchObject({ type: 'image', name: 'image-M1.jpg', downloadUrl: '/v2/messages/attachment?message_id=M1' })
        expect(summary.transcript).toBeUndefined()
    })

    it('wakes without the words when the audio cannot be had', async () => {
        vi.mocked(downloadAttachment).mockRejectedValue(new LinkupError('INVALID_PARAMS', 'not found', 400))
        const [summary] = await summarizeAttachments({ accountId: 'acc', connectionId: 'conn-1', attachments: [voice], base: {}, budgetMs: 1_000 })
        expect(summary).toMatchObject({ transcript: null, transcriptError: 'The audio could not be fetched.' })
        expect(summary.url).not.toBeNull()
    })

    it('gives up on the words past its budget', async () => {
        vi.mocked(downloadAttachment).mockResolvedValue({ body: streamOf('opus'), contentType: 'audio/ogg', filename: null, size: 4 })
        vi.mocked(transcribeAudio).mockImplementation((_audio, _format, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))))
        const [summary] = await summarizeAttachments({ accountId: 'acc', connectionId: 'conn-1', attachments: [voice], base: {}, budgetMs: 20 })
        expect(summary).toMatchObject({ transcript: null, transcriptError: 'The transcription took too long.' })
    })

    it('leaves a file with no id as plain information', async () => {
        const [summary] = await summarizeAttachments({ accountId: 'acc', connectionId: 'conn-1', attachments: [{ type: 'file', name: 'devis.pdf' }], base: {}, budgetMs: 1_000 })
        expect(summary).toMatchObject({ name: 'devis.pdf', downloadUrl: null, url: null })
    })
})
