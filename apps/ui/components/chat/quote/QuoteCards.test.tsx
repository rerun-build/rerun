// @vitest-environment happy-dom
import { QUOTE_FROM_USER, type MessageQuote } from '@rerun/contracts'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

const { QuoteInBubble, QuoteStrip } = await import('./QuoteCards')
const { QuoteReplyContext } = await import('./useQuoteReply')

const quote: MessageQuote = { from: 'Nova', messageId: 'engine-a1', text: 'The split:\n\n38 have fewer than 10 people\n7 are hiring right now' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const render = (node: ReactElement) => act(() => root.render(node))

describe('QuoteInBubble', () => {
    it('names the coworker and reads a quoted list on one line', () => {
        render(createElement(QuoteInBubble, { quote }))
        expect(container.textContent).toBe('NovaThe split: · 38 have fewer than 10 people · 7 are hiring right now')
        expect(container.querySelector('button')).toBeNull()
    })

    it('names a passage of the person in the screen language', () => {
        render(createElement(QuoteInBubble, { quote: { ...quote, from: QUOTE_FROM_USER } }))
        expect(container.textContent?.startsWith('You')).toBe(true)
    })

    it('leads back to the source where the chat can reply', () => {
        const showSource = vi.fn()
        render(createElement(QuoteReplyContext, { value: { quoteBubble: vi.fn(), showSource } }, createElement(QuoteInBubble, { quote })))
        act(() => container.querySelector('button')?.click())
        expect(showSource).toHaveBeenCalledWith(quote)
    })
})

describe('QuoteStrip', () => {
    it('shows the passage and drops it on its ✕', () => {
        const onRemove = vi.fn()
        const onShowSource = vi.fn()
        render(createElement(QuoteStrip, { quote, onRemove, onShowSource }))
        expect(container.textContent).toContain('Nova · The split: · 38 have fewer than 10 people')
        act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove the quote"]')?.click())
        expect(onRemove).toHaveBeenCalledOnce()
        act(() => container.querySelector<HTMLButtonElement>('[aria-label="Go to the quoted message"]')?.click())
        expect(onShowSource).toHaveBeenCalledWith(quote)
    })

    it('closes when nothing is quoted', () => {
        render(createElement(QuoteStrip, { quote: null, onRemove: vi.fn(), onShowSource: vi.fn() }))
        expect(container.firstElementChild?.className).toContain('grid-rows-[0fr]')
    })
})
