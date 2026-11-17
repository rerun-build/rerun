/** Label shown in place of a URL, mapped back to the full URL when the text leaves the composer. */
export type ComposerLinks = Map<string, string>

/** An agent, a skill or a linked computer as the mention autocomplete writes it: `@handle`, `/slug` or `#handle`. It stays in the text as typed. */
export type ComposerMention = { text: string; kind: 'agent' | 'skill' | 'computer' }

export type ComposerSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string } | { kind: 'mention'; text: string; mention: ComposerMention['kind'] }

export type TextRange = { start: number; end: number }

export const COMPOSER_MENTION_TAG = 'composer-mention'
export const COMPOSER_MENTION_KIND_ATTRIBUTE = 'kind'
export const COMPOSER_LINK_TAG = 'composer-link'

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g
const URL_BEFORE_CARET = /(?:^|\s)(https?:\/\/[^\s<>"'`]+)$/
// A mention stands alone: `@bob` is not one inside `mail@bob.com`, nor at the start of `@bobby`.
const MENTION_START = '(?<=^|\\s)'
const MENTION_END = '(?=$|[\\s.,;:!?)\\]}\'"])'
// The chip draws its link icon over the two figure spaces a label opens with, and its right padding over
// the narrow space it closes with. Both are no-break spaces, and nobody types them: a label cannot be
// mistaken for text the user wrote.
const CHIP_LEAD = '\u2007\u2007'
const CHIP_TAIL = '\u202f'
const TRAILING_PUNCTUATION = /[.,;:!?'"\]}]+$/
const ELLIPSIS = '…'
const NON_BREAKING_HYPHEN = '\u2011'
const WORD_JOINER = '\u2060'
const LAST_SEGMENT_MAX = 24

/** A closing parenthesis belongs to the URL only when it closes one the URL opened (Wikipedia-style). */
export function trimUrl(candidate: string): string {
    let url = candidate.replace(TRAILING_PUNCTUATION, '')
    while (url.endsWith(')') && url.split('(').length < url.split(')').length) {
        url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
    }
    return url
}

/** `github.com/…/pull/839`: the host, then the tail of the path, which is what tells two links apart. */
export function shortenUrl(url: string): string {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return url
    }

    const host = parsed.hostname.replace(/^www\./, '')
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments.at(-1)
    // Cut in the middle: slugs that share a beginning usually differ at their end (`…-part-1`, `…-part-2`).
    const tail = last && last.length > LAST_SEGMENT_MAX ? `${last.slice(0, LAST_SEGMENT_MAX / 2)}${ELLIPSIS}${WORD_JOINER}${last.slice(1 - LAST_SEGMENT_MAX / 2)}` : last

    let label = host
    if (segments.length === 1) label = `${host}/${tail}`
    else if (segments.length > 1) label = `${host}/${ELLIPSIS}/${tail}`

    if ((parsed.search || parsed.hash) && !label.endsWith(ELLIPSIS)) label = `${label}${ELLIPSIS}`

    // A label is a display string, never sent: non-breaking hyphens and the word joiner keep a chip from splitting across two lines.
    return label.replaceAll('-', NON_BREAKING_HYPHEN)
}

function labelFor(url: string, links: ComposerLinks): string {
    const base = `${CHIP_LEAD}${shortenUrl(url)}${CHIP_TAIL}`
    for (let copy = 1; ; copy++) {
        const label = copy === 1 ? base : `${base.slice(0, -CHIP_TAIL.length)}~${copy}${CHIP_TAIL}`
        const owner = links.get(label)
        if (owner === undefined || owner === url) return label
    }
}

/** Swaps each URL of `text` for its chip label, recording the label in `links` so the text can be expanded back. */
export function collapseLinks(text: string, links: ComposerLinks): string {
    return text.replace(URL_PATTERN, match => {
        const url = trimUrl(match)
        const label = labelFor(url, links)
        links.set(label, url)
        return `${label}${match.slice(url.length)}`
    })
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Longest first, so a `~2` label is never cut short by the label it was derived from, nor `@bob-ops` by `@bob`.
function tokenPattern(links: ComposerLinks, mentions: ComposerMention[]): RegExp | null {
    const alternatives = [
        ...[...links.keys()].map(label => ({ length: label.length, source: escapeRegExp(label) })),
        ...mentions.map(({ text }) => ({ length: text.length, source: `${MENTION_START}${escapeRegExp(text)}${MENTION_END}` })),
    ]
    if (alternatives.length === 0) return null
    return new RegExp(
        alternatives
            .sort((a, b) => b.length - a.length)
            .map(alternative => alternative.source)
            .join('|'),
        'g'
    )
}

export function expandLinks(text: string, links: ComposerLinks): string {
    const pattern = tokenPattern(links, [])
    return pattern ? text.replace(pattern, label => links.get(label) ?? label) : text
}

/** Where the link labels and the mentions sit: the composer handles each one as a single character. */
export function tokenRanges(text: string, links: ComposerLinks, mentions: ComposerMention[] = []): TextRange[] {
    const pattern = tokenPattern(links, mentions)
    if (!pattern) return []
    return [...text.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }))
}

/** Where a URL typed right before the caret starts and ends. */
export function urlBeforeCaret(text: string, caret: number): (TextRange & { url: string }) | null {
    const match = text.slice(0, caret).match(URL_BEFORE_CARET)
    if (!match) return null
    const url = trimUrl(match[1])
    const start = caret - match[1].length
    return { start, end: start + url.length, url }
}

export function tokenizeComposer(text: string, links: ComposerLinks, mentions: ComposerMention[] = []): ComposerSegment[] {
    const pattern = tokenPattern(links, mentions)
    if (!pattern) return text ? [{ kind: 'text', text }] : []

    const mentionKinds = new Map(mentions.map(mention => [mention.text, mention.kind]))
    const segments: ComposerSegment[] = []
    let cursor = 0
    for (const match of text.matchAll(pattern)) {
        if (match.index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, match.index) })
        const url = links.get(match[0])
        const mention = mentionKinds.get(match[0])
        segments.push(url === undefined && mention ? { kind: 'mention', text: match[0], mention } : { kind: 'link', text: match[0], url: url ?? match[0] })
        cursor = match.index + match[0].length
    }
    if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
    return segments
}

type MarkdownNode = {
    type?: string
    url?: string
    value?: string
    data?: { hProperties?: Record<string, unknown>; [key: string]: unknown }
    children?: MarkdownNode[]
}

/**
 * A bare URL in a message reads as its short label, with the full URL on hover. Named links keep
 * their text. The title sits on an element inside the link: Streamdown's link-safety button drops the
 * attributes of the link itself.
 */
export function remarkShortLinks() {
    return (tree: MarkdownNode) => {
        const visit = (node: MarkdownNode) => {
            const onlyChild = node.children?.length === 1 ? node.children[0] : undefined
            if (node.type === 'link' && node.url && onlyChild?.type === 'text' && onlyChild.value === node.url) {
                onlyChild.value = shortenUrl(node.url)
                onlyChild.data = { ...onlyChild.data, hName: COMPOSER_LINK_TAG, hProperties: { title: node.url } }
            }
            node.children?.forEach(visit)
        }

        visit(tree)
    }
}

/** Each known `@agent` and `/skill` of a sent message reads as the token it was in the composer. */
export function remarkMentions({ mentions }: { mentions: ComposerMention[] }) {
    return (tree: MarkdownNode) => {
        if (mentions.length === 0) return
        const visit = (node: MarkdownNode) => {
            if (!node.children || node.type === 'link' || node.type === 'linkReference') return
            node.children = node.children.flatMap(child => {
                if (child.type !== 'text' || !child.value) {
                    visit(child)
                    return [child]
                }
                const segments = tokenizeComposer(child.value, new Map(), mentions)
                if (!segments.some(segment => segment.kind === 'mention')) return [child]
                return segments.map(segment =>
                    segment.kind === 'mention'
                        ? { type: 'text', value: segment.text, data: { hName: COMPOSER_MENTION_TAG, hProperties: { [COMPOSER_MENTION_KIND_ATTRIBUTE]: segment.mention } } }
                        : { type: 'text', value: segment.text }
                )
            })
        }

        visit(tree)
    }
}
