// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { findQuoteSource, rangeOfText } from './quote-source'

afterEach(() => document.body.replaceChildren())

function chat(html: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return root
}

describe('rangeOfText', () => {
    it('finds a passage read across the items of a list', () => {
        const root = chat('<div data-quote-text="assistant"><p>The split:</p><ul><li>38 have <strong>fewer</strong> than 10</li><li>7 are hiring</li></ul></div>')
        const range = rangeOfText(root, 'fewer than 10\n7 are')
        expect(range?.toString()).toBe('fewer than 107 are')
    })

    it('returns null when the passage is not there', () => {
        expect(rangeOfText(chat('<p>Hello</p>'), 'Goodbye')).toBeNull()
    })
})

describe('findQuoteSource', () => {
    const html = '<div data-message-id="engine-a1"><div data-quote-text="assistant">First beat.</div><div data-quote-text="assistant">Most list a generic address.</div></div><div data-message-id="u2"><div data-quote-text="user">Which ones?</div></div>'

    it('finds the bubble of the message the quote names', () => {
        const source = findQuoteSource(chat(html), { from: 'Nova', messageId: 'engine-a1', text: 'a generic address' })
        expect(source?.bubble.textContent).toBe('Most list a generic address.')
        expect(source?.range?.toString()).toBe('a generic address')
    })

    it('falls back to the passage anywhere in the chat once the message took another id', () => {
        const source = findQuoteSource(chat(html), { from: 'Nova', messageId: 'client-123', text: 'First beat.' })
        expect(source?.bubble.textContent).toBe('First beat.')
    })

    it('finds nothing for a passage the chat no longer holds', () => {
        expect(findQuoteSource(chat(html), { from: 'Nova', messageId: 'gone', text: 'Something else' })).toBeNull()
    })
})
