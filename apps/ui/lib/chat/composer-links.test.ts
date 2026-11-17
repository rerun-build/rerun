import { describe, expect, it } from 'vitest'
import { collapseLinks, expandLinks, remarkMentions, remarkShortLinks, shortenUrl, tokenizeComposer, tokenRanges, trimUrl, urlBeforeCaret, type ComposerLinks, type ComposerMention } from './composer-links'

const PR = 'https://github.com/rerun-build/rerun/pull/839/files?diff=split'
const chip = (label: string) => `  ${label} `

describe('shortenUrl', () => {
    it('keeps the host and the last path segment, and marks the dropped query', () => {
        expect(shortenUrl(PR)).toBe('github.com/…/files…')
    })

    it('drops the scheme and www of a short URL and nothing else', () => {
        expect(shortenUrl('https://www.rerun.build')).toBe('rerun.build')
        expect(shortenUrl('https://rerun.build/pricing')).toBe('rerun.build/pricing')
    })

    it('cuts a very long last segment in the middle, with hyphens that do not break', () => {
        expect(shortenUrl('https://docs.example.com/guides/a-very-long-article-slug-that-goes-on-and-on')).toBe('docs.example.com/…/a‑very‑long‑…⁠s‑on‑and‑on')
    })
})

describe('trimUrl', () => {
    it.each([
        ['https://example.com/a.', 'https://example.com/a'],
        ['https://example.com/a),', 'https://example.com/a'],
        ['https://en.wikipedia.org/wiki/Rust_(language)', 'https://en.wikipedia.org/wiki/Rust_(language)'],
        ['https://en.wikipedia.org/wiki/Rust_(language))', 'https://en.wikipedia.org/wiki/Rust_(language)'],
    ])('trims %s', (raw, url) => {
        expect(trimUrl(raw)).toBe(url)
    })
})

describe('collapseLinks / expandLinks', () => {
    it('round-trips a message, punctuation left outside the chip', () => {
        const links: ComposerLinks = new Map()
        const text = `Look at ${PR}. Also https://rerun.build and (${PR}).`
        const collapsed = collapseLinks(text, links)
        expect(collapsed).toBe(`Look at ${chip('github.com/…/files…')}. Also ${chip('rerun.build')} and (${chip('github.com/…/files…')}).`)
        expect(expandLinks(collapsed, links)).toBe(text)
    })

    it('gives two URLs sharing a label distinct labels', () => {
        const links: ComposerLinks = new Map()
        const other = 'https://github.com/rerun-build/other-repo/pull/12/files?diff=unified'
        const collapsed = collapseLinks(`${PR} ${other}`, links)
        expect(collapsed).toBe(`${chip('github.com/…/files…')} ${chip('github.com/…/files…~2')}`)
        expect(expandLinks(collapsed, links)).toBe(`${PR} ${other}`)
    })

    it('leaves text the user wrote alone, even when it reads like a label', () => {
        const links: ComposerLinks = new Map()
        collapseLinks('https://rerun.build', links)
        expect(expandLinks('I work on rerun.build', links)).toBe('I work on rerun.build')
    })
})

describe('urlBeforeCaret', () => {
    it('finds a URL typed right before the caret, without its punctuation', () => {
        const text = `see ${PR}.`
        expect(urlBeforeCaret(text, text.length)).toEqual({ start: 4, end: 4 + PR.length, url: PR })
    })

    it('ignores a URL glued to a word', () => {
        expect(urlBeforeCaret(`x${PR}`, PR.length + 1)).toBeNull()
    })
})

describe('tokenizeComposer', () => {
    it('marks the labels and leaves a raw URL as text', () => {
        const links: ComposerLinks = new Map()
        const text = `${collapseLinks(`a ${PR} b`, links)} https://unlinked.dev`
        expect(tokenizeComposer(text, links)).toEqual([
            { kind: 'text', text: 'a ' },
            { kind: 'link', text: chip('github.com/…/files…'), url: PR },
            { kind: 'text', text: ' b https://unlinked.dev' },
        ])
        expect(tokenRanges(text, links)).toEqual([{ start: 2, end: 2 + chip('github.com/…/files…').length }])
    })

    const mentions: ComposerMention[] = [
        { text: '@bob', kind: 'agent' },
        { text: '@bob-ops', kind: 'agent' },
        { text: '/weekly-report', kind: 'skill' },
    ]

    it('marks the known mentions, next to a link', () => {
        const links: ComposerLinks = new Map()
        const text = `@bob-ops run /weekly-report on ${collapseLinks(PR, links)} /weekly-report, then @bob.`
        expect(tokenizeComposer(text, links, mentions)).toEqual([
            { kind: 'mention', text: '@bob-ops', mention: 'agent' },
            { kind: 'text', text: ' run ' },
            { kind: 'mention', text: '/weekly-report', mention: 'skill' },
            { kind: 'text', text: ' on ' },
            { kind: 'link', text: chip('github.com/…/files…'), url: PR },
            { kind: 'text', text: ' ' },
            { kind: 'mention', text: '/weekly-report', mention: 'skill' },
            { kind: 'text', text: ', then ' },
            { kind: 'mention', text: '@bob', mention: 'agent' },
            { kind: 'text', text: '.' },
        ])
    })

    it('leaves a mention glued to a word, or cut short of a longer name, as text', () => {
        const text = 'mail@bob.com @bobby @unknown'
        expect(tokenizeComposer(text, new Map(), mentions)).toEqual([{ kind: 'text', text }])
        expect(tokenRanges(text, new Map(), mentions)).toEqual([])
    })
})

describe('remarkShortLinks', () => {
    it('shortens a bare URL and leaves a named link alone', () => {
        const bare = { type: 'link', url: PR, children: [{ type: 'text', value: PR }] }
        const named = { type: 'link', url: PR, children: [{ type: 'text', value: 'the PR' }] }
        remarkShortLinks()({ type: 'root', children: [bare, named] })
        expect(bare.children[0].value).toBe('github.com/…/files…')
        expect(bare.children[0]).toMatchObject({ data: { hName: 'composer-link', hProperties: { title: PR } } })
        expect(named.children[0].value).toBe('the PR')
    })
})

describe('remarkMentions', () => {
    const mentions: ComposerMention[] = [
        { text: '@bob', kind: 'agent' },
        { text: '@bob-ops', kind: 'agent' },
        { text: '/deploy', kind: 'skill' },
    ]
    const run = (children: object[]) => {
        const paragraph = { type: 'paragraph', children }
        remarkMentions({ mentions })({ type: 'root', children: [paragraph] })
        return paragraph.children
    }

    it('wraps each known mention in its token and leaves the text around it', () => {
        expect(run([{ type: 'text', value: 'ask @bob to /deploy.' }])).toEqual([
            { type: 'text', value: 'ask ' },
            { type: 'text', value: '@bob', data: { hName: 'composer-mention', hProperties: { kind: 'agent' } } },
            { type: 'text', value: ' to ' },
            { type: 'text', value: '/deploy', data: { hName: 'composer-mention', hProperties: { kind: 'skill' } } },
            { type: 'text', value: '.' },
        ])
    })

    it('takes the longest mention and skips one inside a word', () => {
        const children = run([{ type: 'text', value: '@bob-ops @bobby mail@bob.com' }])
        expect(children[0]).toMatchObject({ value: '@bob-ops', data: { hName: 'composer-mention' } })
        expect(children.slice(1)).toEqual([{ type: 'text', value: ' @bobby mail@bob.com' }])
    })

    it('leaves inline code and link text alone', () => {
        const code = { type: 'inlineCode', value: '@bob' }
        const link = { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '@bob' }] }
        expect(run([code, link])).toEqual([code, link])
        expect(link.children).toEqual([{ type: 'text', value: '@bob' }])
    })
})

describe('the #handle of a linked computer', () => {
    const mentions = [
        { text: '#studio-pc', kind: 'computer' as const },
        { text: '@scout', kind: 'agent' as const },
    ]

    it('becomes a token when it names a linked computer, and stays text otherwise', () => {
        expect(tokenizeComposer('Encode on #studio-pc, then post #marketing', new Map(), mentions)).toEqual([
            { kind: 'text', text: 'Encode on ' },
            { kind: 'mention', text: '#studio-pc', mention: 'computer' },
            { kind: 'text', text: ', then post #marketing' },
        ])
        expect(tokenizeComposer('see #studio-pcs', new Map(), mentions)).toEqual([{ kind: 'text', text: 'see #studio-pcs' }])
    })
})
