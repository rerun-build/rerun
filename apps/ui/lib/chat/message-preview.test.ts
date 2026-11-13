import { appendAttachmentsRef, appendVoiceMarker, buildAttachmentsRef, buildVoiceMarker, MESSAGE_PREVIEW_MAX, messagePreview } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

describe('messagePreview', () => {
    it('reads markdown as the text it renders, on one line', () => {
        expect(messagePreview('## Weekly report\n\n- **3** new leads\n- see [the sheet](https://x.test/s)\n\n> quoted')).toBe('Weekly report 3 new leads see the sheet quoted')
        expect(messagePreview('Run `pnpm test` then _ship_ it')).toBe('Run pnpm test then ship it')
        expect(messagePreview('```ts\nconst a = 1\n```')).toBe('const a = 1')
    })

    it('reads a table as its cells', () => {
        expect(messagePreview('| Lead | City |\n| --- | :---: |\n| Acme | Lyon |')).toBe('Lead City Acme Lyon')
    })

    it('keeps snake_case and arithmetic as they are', () => {
        expect(messagePreview('rename user_id to owner_id, 2 * 3 * 4')).toBe('rename user_id to owner_id, 2 * 3 * 4')
    })

    it('reads a voice message as its transcript', () => {
        const marker = buildVoiceMarker({ src: 'https://x.test/a.webm', durationMs: 3000, levels: [0.2, 0.5] })
        expect(messagePreview(appendVoiceMarker('Call Acme back', marker))).toBe('Call Acme back')
        expect(messagePreview(marker)).toBe('')
    })

    it('names the files sent without a word, and keeps the words when there are some', () => {
        const ref = buildAttachmentsRef(['chat-uploads/mh1abcd0-AbC123-report.pdf', 'chat-uploads/mh1abcd0-XyZ789-photo.png'])
        expect(messagePreview(appendAttachmentsRef('', ref))).toBe('report.pdf, photo.png')
        expect(messagePreview(appendAttachmentsRef('Here are the files', ref))).toBe('Here are the files')
    })

    it('cuts a long message on a word, with an ellipsis', () => {
        const preview = messagePreview(`${'word '.repeat(80)}end`)
        expect(preview.length).toBeLessThanOrEqual(MESSAGE_PREVIEW_MAX)
        expect(preview.endsWith('word…')).toBe(true)
    })

    it('reads the start of a message only, however long its runs of empty lines', () => {
        expect(messagePreview(`hello${'\n'.repeat(5_000)}world`)).toBe('hello')
        expect(messagePreview(`${'\n'.repeat(5_000)}hello`)).toBe('hello')
        expect(messagePreview(`hello${' \n'.repeat(900)}world`)).toBe('hello world')
    })

    it('leaves nothing for a message with nothing to show', () => {
        expect(messagePreview('   \n  ')).toBe('')
    })
})
