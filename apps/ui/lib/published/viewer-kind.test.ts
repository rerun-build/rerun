import { describe, expect, it } from 'vitest'
import { isMarkdownDeck, splitMarkdownSlides, viewerKindOf } from './viewer-kind'

describe('viewerKindOf', () => {
    it('trusts a specific content type', () => {
        expect(viewerKindOf('application/pdf', 'x.bin')).toBe('pdf')
        expect(viewerKindOf('image/png', 'x')).toBe('image')
        expect(viewerKindOf('text/csv; charset=utf-8', 'x')).toBe('csv')
    })

    it('falls back on the extension for a generic type', () => {
        expect(viewerKindOf('application/octet-stream', 'docs/pricing-faq.md')).toBe('markdown')
        expect(viewerKindOf('text/plain; charset=utf-8', 'leads.csv')).toBe('csv')
        expect(viewerKindOf('application/octet-stream', 'clip.MP4')).toBe('video')
        expect(viewerKindOf('application/zip', 'brand-assets.zip')).toBe('file')
    })
})

describe('isMarkdownDeck', () => {
    it('needs the file name or the frontmatter to say so', () => {
        expect(isMarkdownDeck('launch.slides.md', '# A')).toBe(true)
        expect(isMarkdownDeck('deck.md', '---\nmarp: true\n---\n# A\n---\n# B')).toBe(true)
        expect(isMarkdownDeck('deck.md', '---\ntitle: x\nslides: true\n---\n# A')).toBe(true)
        expect(isMarkdownDeck('notes.md', '# A\n\n---\n\n# B')).toBe(false)
        expect(isMarkdownDeck('notes.md', '---\ntitle: x\n---\n# A')).toBe(false)
    })
})

describe('splitMarkdownSlides', () => {
    it('splits on bare --- lines, drops the frontmatter and empty slides', () => {
        expect(splitMarkdownSlides('---\nmarp: true\n---\n# A\n---\n\n---\n# B\n')).toEqual(['# A', '# B\n'])
    })

    it('never splits inside a fenced block', () => {
        expect(splitMarkdownSlides('# A\n```yaml\n---\nkey: 1\n```\n---\n# B')).toEqual(['# A\n```yaml\n---\nkey: 1\n```', '# B'])
    })
})
