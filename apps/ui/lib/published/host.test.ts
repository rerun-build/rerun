import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPublishedSlug, isValidSlugLabel, publishedRawFileUrl, publishedSiteOrigin, rendersAsPage, suffixedSlug } from './host'

describe('publish host', () => {
    beforeEach(() => vi.stubEnv('PUBLISH_HOST', 'rerun.site'))
    afterEach(() => vi.unstubAllEnvs())

    it('reads the slug of a single-level subdomain', () => {
        expect(extractPublishedSlug('copilote-seo-kit-fr.rerun.site')).toBe('copilote-seo-kit-fr')
        expect(extractPublishedSlug('AbC123.rerun.site:443')).toBe('abc123')
    })

    it('rejects the app, nested and reserved hosts', () => {
        expect(extractPublishedSlug('app.rerun.build')).toBeNull()
        expect(extractPublishedSlug('rerun.site')).toBeNull()
        expect(extractPublishedSlug('a.b.rerun.site')).toBeNull()
        expect(extractPublishedSlug('www.rerun.site')).toBeNull()
        expect(extractPublishedSlug('welcome.rerun.site')).toBeNull()
        expect(extractPublishedSlug('evil.rerun.site.attacker.com')).toBeNull()
        expect(extractPublishedSlug(null)).toBeNull()
    })

    it('is off when no publish host is configured', () => {
        vi.stubEnv('PUBLISH_HOST', '')
        expect(extractPublishedSlug('abc.rerun.site')).toBeNull()
        expect(publishedSiteOrigin('abc')).toBeNull()
    })

    it('serves dev over plain http on localhost', () => {
        vi.stubEnv('PUBLISH_HOST', 'localhost:3050')
        expect(extractPublishedSlug('demo.localhost:3050')).toBe('demo')
        expect(publishedSiteOrigin('demo')).toBe('http://demo.localhost:3050')
    })

    it('builds the https origin of a slug', () => {
        expect(publishedSiteOrigin('demo')).toBe('https://demo.rerun.site')
    })

    it('serves the bytes of a file at a reserved path of its host', () => {
        expect(publishedRawFileUrl('photo')).toBe('https://photo.rerun.site/__rerun/raw')
        vi.stubEnv('PUBLISH_HOST', '')
        expect(publishedRawFileUrl('photo')).toBeNull()
    })
})

describe('isValidSlugLabel', () => {
    it('accepts DNS labels only', () => {
        expect(isValidSlugLabel('report-q2')).toBe(true)
        expect(isValidSlugLabel('report-')).toBe(false)
        expect(isValidSlugLabel('-report')).toBe(false)
        expect(isValidSlugLabel('a')).toBe(false)
        expect(isValidSlugLabel('xn--bcher-kva')).toBe(false)
        expect(isValidSlugLabel('a'.repeat(64))).toBe(false)
    })
})

describe('rendersAsPage', () => {
    it('is true for sites and HTML files only', () => {
        expect(rendersAsPage('site', 'text/html; charset=utf-8')).toBe(true)
        expect(rendersAsPage('file', 'text/html; charset=utf-8')).toBe(true)
        expect(rendersAsPage('file', 'image/png')).toBe(false)
    })
})

describe('suffixedSlug', () => {
    const token = 'k3m9xqw7pt'

    it('always appends the token to the chosen name', () => {
        expect(suffixedSlug('yc-video-script', token)).toBe(`yc-video-script-${token}`)
        expect(suffixedSlug('  Q2-Report ', token)).toBe(`q2-report-${token}`)
        expect(suffixedSlug('www', token)).toBe(`www-${token}`)
    })

    it('never suffixes a full slug handed back a second time', () => {
        expect(suffixedSlug(`q2-report-${token}`, 'abcdefghjk')).toBe('q2-report-abcdefghjk')
        expect(suffixedSlug('launch-2026abcdef', token)).toBe(`launch-2026abcdef-${token}`)
    })

    it('truncates a long name to fit a DNS label', () => {
        const slug = suffixedSlug(`${'a'.repeat(51)}-${'b'.repeat(24)}`, token)
        expect(slug.length).toBeLessThanOrEqual(63)
        expect(slug).toBe(`${'a'.repeat(51)}-${token}`)
        expect(isValidSlugLabel(slug)).toBe(true)
    })

    it('rejects names that are not a DNS label', () => {
        expect(() => suffixedSlug('YC Video Script', token)).toThrow('Invalid slug')
        expect(() => suffixedSlug('-demo', token)).toThrow('Invalid slug')
        expect(() => suffixedSlug('---', token)).toThrow('Invalid slug')
        expect(() => suffixedSlug('xn--abc', token)).toThrow('Invalid slug')
    })
})
