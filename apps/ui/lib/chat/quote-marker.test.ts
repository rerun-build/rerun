import { appendAttachmentsRef, appendVoiceMarker, buildAttachmentsRef, buildQuoteBlock, buildVoiceMarker, editableTextOf, messagePreview, parseAttachments, parseQuote, parseVoiceMessage, plainQuoteOf, prependQuote, quoteAsMarkdown, queuedPreview, quotePreview, stripQuote, QUOTE_FROM_USER, type MessageQuote } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

const quote: MessageQuote = { from: 'Nova', messageId: 'engine-a1', text: 'Most of them list a generic contact address rather than a named person' }

describe('buildQuoteBlock', () => {
    it('keeps the wording the coworker reads', () => {
        expect(prependQuote('Which ones?', quote)).toBe('<quote from="Nova" message="engine-a1">\nMost of them list a generic contact address rather than a named person\n</quote>\n\nWhich ones?')
    })
})

describe('parseQuote', () => {
    it('round-trips the passage, its author, its message and the question', () => {
        const parsed = parseQuote(prependQuote('  Which ones?  ', quote))
        expect(parsed?.quote).toEqual(quote)
        expect(parsed?.text).toBe('Which ones?')
    })

    it('reads a reply that is only the quote', () => {
        const parsed = parseQuote(prependQuote('', quote))
        expect(parsed?.quote).toEqual(quote)
        expect(parsed?.text).toBe('')
    })

    it('keeps the lines of a quoted list', () => {
        const list: MessageQuote = { ...quote, text: 'The split:\n\n38 have fewer than 10 people\n7 are hiring right now' }
        expect(parseQuote(prependQuote('Start with those.', list))?.quote.text).toBe(list.text)
    })

    it('keeps a closing tag written inside the passage', () => {
        const tricky: MessageQuote = { from: 'A "quoted" & name', messageId: 'm"1', text: 'before </quote> after' }
        const block = buildQuoteBlock(tricky)
        expect(block.match(/<\/quote>/g)).toHaveLength(1)
        expect(parseQuote(`${block}\n\nok`)).toEqual({ quote: tricky, text: 'ok' })
    })

    it('leaves the voice marker and the attachments at the end', () => {
        const voice = appendVoiceMarker('What about these?', buildVoiceMarker({ src: 'chat-uploads/a.m4a', durationMs: 1200, levels: [0.2, 0.8] }))
        const sent = appendAttachmentsRef(prependQuote(voice, quote), buildAttachmentsRef(['chat-uploads/a.png']))
        const parsed = parseQuote(sent)
        expect(parsed?.quote).toEqual(quote)
        const attachments = parseAttachments(parsed?.text ?? '')
        expect(attachments?.paths).toEqual(['chat-uploads/a.png'])
        expect(parseVoiceMessage(attachments?.text ?? '')?.transcript).toBe('What about these?')
    })

    it('only reads a block that opens the message', () => {
        expect(parseQuote(`Look:\n\n${buildQuoteBlock(quote)}`)).toBeNull()
        expect(parseQuote('Just a message')).toBeNull()
    })

    it('reads a passage of the person under the constant the coworker reads', () => {
        expect(parseQuote(prependQuote('Still true?', { ...quote, from: QUOTE_FROM_USER }))?.quote.from).toBe('You')
    })
})

describe('stripQuote', () => {
    it('keeps the words of the person', () => {
        expect(stripQuote(prependQuote('Which ones?', quote))).toBe('Which ones?')
        expect(stripQuote('Which ones?')).toBe('Which ones?')
    })
})

describe('quotePreview', () => {
    it('reads a quoted list on one line', () => {
        expect(quotePreview('The split:\n\n- 38 small\n- 7 hiring')).toBe('The split: · - 38 small · - 7 hiring')
    })
})

describe('the readers of a message', () => {
    it('preview the question, or the passage when nothing else was written', () => {
        expect(messagePreview(prependQuote('Which ones?', quote))).toBe('Which ones?')
        expect(messagePreview(prependQuote('', quote))).toBe(quote.text)
    })

    it('show the question in the queued pill, or the passage alone', () => {
        expect(queuedPreview(prependQuote('Which ones?', quote)).text).toBe('Which ones?')
        expect(queuedPreview(prependQuote('', quote)).text).toBe(quote.text)
    })

    it('edit the question and send the quote back with it', () => {
        const sent = appendAttachmentsRef(prependQuote('Which ones?', quote), buildAttachmentsRef(['chat-uploads/a.png']))
        const editable = editableTextOf({ id: 'u1', role: 'user', parts: [{ type: 'text', text: sent }] })
        expect(editable?.text).toBe('Which ones?')
        expect(editable?.rebuild('Which ones are hiring?')).toBe(appendAttachmentsRef(prependQuote('Which ones are hiring?', quote), buildAttachmentsRef(['chat-uploads/a.png'])))
    })
})

describe('plainQuoteOf', () => {
    it('reads a bubble as it shows on screen', () => {
        expect(plainQuoteOf('The **split**:\n\n- 38 have [fewer](https://x.y) than 10\n- 7 use `Framer`')).toBe('The split:\n\n38 have fewer than 10\n7 use Framer')
    })
})

describe('quoteAsMarkdown', () => {
    it('reads a reply as markdown for a build that knows no quote', () => {
        expect(quoteAsMarkdown(prependQuote('Which ones?', quote))).toBe(`> **Nova** · ${quote.text}\n\nWhich ones?`)
        expect(quoteAsMarkdown(prependQuote('', { ...quote, from: QUOTE_FROM_USER }))).toBe(`> ${quote.text}`)
        expect(quoteAsMarkdown('Just a message')).toBe('Just a message')
    })
})
