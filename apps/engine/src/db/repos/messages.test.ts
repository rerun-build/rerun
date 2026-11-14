import { describe, expect, it } from 'vitest'
import { extractText } from './messages.js'

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
