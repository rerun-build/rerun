import { shortenUrl } from './short-link'

describe('shortenUrl', () => {
    it('keeps the host and the last path segment, and marks the dropped query', () => {
        expect(shortenUrl('https://github.com/rerun-build/rerun/pull/839/files?diff=split')).toBe('github.com/…/files…')
    })

    it('drops the scheme and www of a short URL and nothing else', () => {
        expect(shortenUrl('https://www.rerun.build')).toBe('rerun.build')
        expect(shortenUrl('https://rerun.build/pricing')).toBe('rerun.build/pricing')
    })

    it('cuts a very long last segment in the middle, with hyphens that do not break', () => {
        expect(shortenUrl('https://docs.example.com/guides/a-very-long-article-slug-that-goes-on-and-on')).toBe('docs.example.com/…/a‑very‑long‑…⁠s‑on‑and‑on')
    })

    it('leaves anything but a web address alone', () => {
        expect(shortenUrl('mailto:hello@robagentic.tech')).toBe('mailto:hello@robagentic.tech')
    })
})
