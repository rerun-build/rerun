import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { appendAttachmentsRef, buildAttachmentsRef } from '@/lib/chat/attachments-marker'
import { TEXT_FILE_PAGE_CHARS } from '@moldwright/contracts'

vi.mock('server-only', () => ({}))

const files = new Map<string, Blob>()
vi.mock('@/lib/storage/private', () => ({
    downloadPrivateFile: vi.fn(async (_supabase: unknown, _bucket: string, key: string) => {
        const blob = files.get(key.split('/').slice(3).join('/'))
        if (!blob) throw new Error('Object not found')
        return blob
    }),
}))

const { withInlineAttachments } = await import('./inline-attachments')

const ctx = { userId: 'u1', workspace: { id: 7 }, supabase: {} } as unknown as Pick<WorkspaceContext, 'userId' | 'workspace' | 'supabase'>

const user = (text: string): UIMessage => ({ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }) as UIMessage
const withFiles = (text: string, paths: string[]) => user(appendAttachmentsRef(text, buildAttachmentsRef(paths)))

beforeEach(() => files.clear())

describe('withInlineAttachments', () => {
    it('hands an image over as a file part next to the marker', async () => {
        files.set('chat-uploads/mtr4k52x-lBg1lF-shot.png', new Blob([new Uint8Array([1, 2, 3])]))
        const [message] = await withInlineAttachments([withFiles('What is this?', ['chat-uploads/mtr4k52x-lBg1lF-shot.png'])], ctx, 's1')
        expect(message.parts).toHaveLength(2)
        expect(message.parts[1]).toEqual({ type: 'file', mediaType: 'image/png', filename: 'shot.png', url: 'data:image/png;base64,AQID' })
    })

    it('hands a pdf over as a file part', async () => {
        files.set('chat-uploads/brief.pdf', new Blob(['%PDF']))
        const [message] = await withInlineAttachments([withFiles('Read this', ['chat-uploads/brief.pdf'])], ctx, 's1')
        expect(message.parts[1]).toMatchObject({ type: 'file', mediaType: 'application/pdf' })
    })

    it('inlines a text file, cut at a page', async () => {
        files.set('chat-uploads/notes.md', new Blob(['x'.repeat(TEXT_FILE_PAGE_CHARS + 10)]))
        const [message] = await withInlineAttachments([withFiles('', ['chat-uploads/notes.md'])], ctx, 's1')
        const text = (message.parts[1] as { text: string }).text
        expect(text).toContain('<file name="notes.md" truncated="true">')
        expect(text.length).toBeLessThan(TEXT_FILE_PAGE_CHARS + 100)
    })

    it('leaves an archive, a binary read as text and a missing file as names only', async () => {
        files.set('chat-uploads/backup.zip', new Blob(['PK']))
        files.set('chat-uploads/deck.docx', new Blob([new Uint8Array([80, 75, 0, 4])]))
        const input = withFiles('Here', ['chat-uploads/backup.zip', 'chat-uploads/deck.docx', 'chat-uploads/gone.md'])
        const [message] = await withInlineAttachments([input], ctx, 's1')
        expect(message).toBe(input)
    })

    it('leaves a message without attachments untouched', async () => {
        const input = user('Hello')
        const [message] = await withInlineAttachments([input], ctx, 's1')
        expect(message).toBe(input)
    })
})
