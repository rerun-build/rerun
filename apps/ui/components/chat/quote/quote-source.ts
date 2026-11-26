import type { MessageQuote } from '@rerun/contracts'

export type QuoteMark = 'draft' | 'flash'

// The person's bubble is drawn in the brand: there the passage keeps its ink and takes a wash instead.
const MARK_NAMES: Record<QuoteMark, { page: string; ink: string }> = {
    draft: { page: 'quote-draft', ink: 'quote-draft-ink' },
    flash: { page: 'quote-flash', ink: 'quote-flash-ink' },
}

// Marks a passage without touching the message's DOM, which Streamdown re-renders while it streams:
// the `::highlight(quote-*)` rules of globals.css. A browser without the API shows no mark, the quote
// itself still works.
export function paintQuoteMark(mark: QuoteMark, range: Range | null, onInk = false) {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const names = MARK_NAMES[mark]
    CSS.highlights.delete(names.page)
    CSS.highlights.delete(names.ink)
    if (range) CSS.highlights.set(onInk ? names.ink : names.page, new Highlight(range))
}

export const isInkSource = (source: HTMLElement) => source.dataset.quoteText === 'user'

export function rangeOver(element: Element): Range {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range
}

/** The text a bubble shows, as the coworker should read it: one blank line at most between blocks. */
export function quotableTextOf(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim()
}

// The passage as it sits in the rendered message. Its text was read with `innerText`, which breaks
// lines where the markdown had blocks and list items, so both sides are compared without whitespace.
export function rangeOfText(root: Element, passage: string): Range | null {
    const target = passage.replace(/\s+/g, '')
    if (!target) return null
    const characters: { node: Text; offset: number }[] = []
    let flat = ''
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (let offset = 0; offset < node.data.length; offset++) {
            if (/\s/.test(node.data[offset])) continue
            characters.push({ node, offset })
            flat += node.data[offset]
        }
    }
    const at = flat.indexOf(target)
    if (at < 0) return null
    const first = characters[at]
    const last = characters[at + target.length - 1]
    const range = document.createRange()
    range.setStart(first.node, first.offset)
    range.setEnd(last.node, last.offset + 1)
    return range
}

// Where a sent quote came from: its message when it is still on screen under the same id, else the
// first bubble of the conversation holding the passage (a message streamed in this tab takes the id
// of its engine row once the history is read again).
export function findQuoteSource(root: HTMLElement | null, quote: MessageQuote): { bubble: HTMLElement; range: Range | null } | null {
    if (!root) return null
    const row = root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(quote.messageId)}"]`)
    for (const scope of row ? [row, root] : [root]) {
        for (const bubble of scope.querySelectorAll<HTMLElement>('[data-quote-text]')) {
            const range = rangeOfText(bubble, quote.text)
            if (range) return { bubble, range }
        }
    }
    const firstBubble = row?.querySelector<HTMLElement>('[data-quote-text]')
    return row && firstBubble ? { bubble: firstBubble, range: rangeOfText(row, quote.text) } : null
}
