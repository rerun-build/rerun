import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-messages-text-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { appendMessage, collectAssistantText, extractText, listMessages } = await import('./messages.js')

describe('extractText', () => {
    it('keeps what the agent said', () => {
        expect(extractText('a plain user turn')).toBe('a plain user turn')
        expect(extractText([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }])).toBe('first second')
    })

    it('never leaks what the agent only thought', () => {
        const content = [
            { type: 'reasoning', text: 'The user probably means the second invoice.' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'list_invoices', input: {} },
            { type: 'text', text: 'Invoice #2 is overdue.' },
        ]

        expect(extractText(content)).toBe('Invoice #2 is overdue.')
    })

    it('leaves out the context the engine appended to a user turn', () => {
        const content = [
            { type: 'text', text: 'is the invoice paid?' },
            { type: 'text', text: '<relevant_memories>\n- (fact) Works for Acme\n</relevant_memories>', providerOptions: { rerun: { context: true } } },
        ]

        expect(extractText(content)).toBe('is the invoice paid?')
    })

    it('reads nothing out of a shape it does not know', () => {
        expect(extractText(undefined)).toBe('')
        expect(extractText([{ type: 'file', mediaType: 'image/png' }])).toBe('')
    })
})

describe('collectAssistantText', () => {
    const FROM = '1970-01-01T00:00:00.000Z'

    it('keeps the line break between the text pieces of one message', async () => {
        await appendMessage('collect', 's1', { role: 'assistant', content: [{ type: 'text', text: 'Now the change.' }, { type: 'text', text: 'PR: https://github.com/o/r/pull/5' }] })

        const out = await collectAssistantText('collect', 's1', FROM, null)

        expect(out.split('\n').at(-1)).toBe('PR: https://github.com/o/r/pull/5')
    })

    it('still separates two assistant messages by a line break, in order', async () => {
        await appendMessage('collect', 's2', { role: 'assistant', content: 'first' })
        await appendMessage('collect', 's2', { role: 'assistant', content: 'second' })

        expect(await collectAssistantText('collect', 's2', FROM, null)).toBe('first\nsecond')
    })

    it('stores a saved message as before', async () => {
        const row = await appendMessage('collect', 's3', { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })

        const saved = (await listMessages('collect', 's3')).find(r => r.id === row.id)
        expect(saved?.contentJson).toBe(JSON.stringify([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))
    })
})
