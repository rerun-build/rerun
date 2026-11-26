// A reply that quotes a passage of an earlier message. The engine only stores the message text, so
// the quote rides in it as a block at the head, before the words of the person (the voice marker and
// the attachments reference stay at the end). The coworker reads it as is: the passage, who wrote it
// and the message it comes from, then the question.
export type MessageQuote = {
    /** Who wrote the passage: the coworker's name, or QUOTE_FROM_USER for a passage of the person. */
    from: string
    /** The message the passage comes from, as the conversation's history names it. */
    messageId: string
    text: string
}

// Written in English on purpose: the coworker reads it, the screen shows its own word for it.
export const QUOTE_FROM_USER = 'You'

const BLOCK = /^<quote from="([^"]*)" message="([^"]*)">\n([\s\S]*?)\n<\/quote>(?:\n+|$)/
const CLOSING_TAG = '</quote>'
const ESCAPED_CLOSING_TAG = '<\\/quote>'

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')

export function buildQuoteBlock(quote: MessageQuote): string {
    const passage = quote.text.trim().replaceAll(CLOSING_TAG, ESCAPED_CLOSING_TAG)
    return `<quote from="${escapeAttribute(quote.from)}" message="${escapeAttribute(quote.messageId)}">\n${passage}\n${CLOSING_TAG}`
}

export function prependQuote(text: string, quote: MessageQuote | null | undefined): string {
    if (!quote) return text
    const body = text.trim()
    return body ? `${buildQuoteBlock(quote)}\n\n${body}` : buildQuoteBlock(quote)
}

export function parseQuote(text: string): { quote: MessageQuote; text: string } | null {
    const match = BLOCK.exec(text)
    if (!match) return null
    return {
        quote: { from: unescapeAttribute(match[1]), messageId: unescapeAttribute(match[2]), text: match[3].replaceAll(ESCAPED_CLOSING_TAG, CLOSING_TAG) },
        text: text.slice(match[0].length),
    }
}

/** The words of the person without the passage they quoted, for anything showing a preview. */
export function stripQuote(text: string): string {
    return parseQuote(text)?.text ?? text
}

// A reply as a build of the app from before quotes reads it: the passage as a markdown quote on one
// line, its author named unless it is the person's own, then their words.
export function quoteAsMarkdown(text: string): string {
    const parsed = parseQuote(text)
    if (!parsed) return text
    const author = parsed.quote.from === QUOTE_FROM_USER ? '' : `**${parsed.quote.from}** · `
    const block = `> ${author}${quotePreview(parsed.quote.text)}`
    return parsed.text ? `${block}\n\n${parsed.text}` : block
}

/** The passage on one line: the lines of a quoted list read one after the other. */
export function quotePreview(text: string): string {
    return text
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .join(' · ')
}

// A bubble's markdown as the passage the app quotes when the whole bubble is swiped: the text a person
// reads on screen, one line per paragraph or list item, as the web reads it from the page.
export function plainQuoteOf(markdown: string): string {
    const lines = markdown.split('\n').map(line =>
        line
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, '$2')
            .replace(/`([^`]*)`/g, '$1')
    )
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
