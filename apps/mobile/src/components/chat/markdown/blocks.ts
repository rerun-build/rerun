import { bubblesOfBlocks, type MessageBubble } from '@moldwright/contracts'
import { Lexer } from 'marked'

const FOOTNOTE_REFERENCE = /\[\^[\w-]{1,200}\](?!:)/
const FOOTNOTE_DEFINITION = /\[\^[\w-]{1,200}\]:/
const OPENING_TAG = /<(\w+)[\s>]/
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

function openingsOf(raw: string, tag: string): number {
    if (VOID_TAGS.has(tag.toLowerCase())) return 0
    const matches = raw.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'gi')) ?? []
    return matches.filter(match => !match.trimEnd().endsWith('/>')).length
}

function closingsOf(raw: string, tag: string): number {
    return raw.match(new RegExp(`</${tag}(?=[\\s>])[^>]*>`, 'gi'))?.length ?? 0
}

function mathFencesOf(text: string): number {
    let count = 0
    for (let i = 0; i < text.length - 1; i += 1) {
        if (text[i] === '$' && text[i + 1] === '$') {
            count += 1
            i += 1
        }
    }
    return count
}

export function markdownBlocksOf(markdown: string): string[] {
    if (FOOTNOTE_REFERENCE.test(markdown) || FOOTNOTE_DEFINITION.test(markdown)) return [markdown]
    const blocks: string[] = []
    const openTags: string[] = []
    let afterCode = false
    for (const token of Lexer.lex(markdown, { gfm: true })) {
        const raw = token.raw
        const count = blocks.length
        if (openTags.length > 0) {
            blocks[count - 1] += raw
            const tag = openTags.at(-1)!
            for (let i = 0; i < openingsOf(raw, tag); i += 1) openTags.push(tag)
            for (let i = 0; i < closingsOf(raw, tag); i += 1) if (openTags.at(-1) === tag) openTags.pop()
            continue
        }
        if (token.type === 'html' && token.block) {
            const tag = raw.match(OPENING_TAG)?.[1]
            if (tag && openingsOf(raw, tag) > closingsOf(raw, tag)) openTags.push(tag)
        }
        if (count > 0 && !afterCode && mathFencesOf(blocks[count - 1]) % 2 === 1) {
            blocks[count - 1] += raw
            continue
        }
        blocks.push(raw)
        if (token.type !== 'space') afterCode = token.type === 'code'
    }
    return blocks
}

export function splitIntoBubbles(markdown: string): MessageBubble[] {
    return bubblesOfBlocks(markdownBlocksOf(markdown))
}
