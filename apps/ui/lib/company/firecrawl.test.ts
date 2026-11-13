import { afterEach, describe, expect, it, vi } from 'vitest'
import { companySiteUrl, isPublicUrl, scrapeCompanySite, scrapePage } from './firecrawl'

describe('companySiteUrl', () => {
    it('turns whatever was typed into the https home of the domain', () => {
        expect(companySiteUrl('acme.com')).toBe('https://acme.com')
        expect(companySiteUrl('  WWW.Acme.co.uk/fr?x=1 ')).toBe('https://acme.co.uk')
        expect(companySiteUrl('http://shop.acme.io:8080/cart')).toBe('https://shop.acme.io')
    })

    it('skips input that could not be a public site', () => {
        expect(companySiteUrl('')).toBeNull()
        expect(companySiteUrl('acme')).toBeNull()
        expect(companySiteUrl('my company')).toBeNull()
        expect(companySiteUrl('acme.c')).toBeNull()
    })

    it('never sends a private or loopback host to the scraper', () => {
        for (const input of ['localhost:3000', 'http://127.0.0.1', '10.0.0.4', '192.168.1.10', '172.16.0.1', '172.31.255.1', '0.0.0.0', 'localhost.localdomain']) {
            expect(companySiteUrl(input)).toBeNull()
        }
    })

    it('keeps a public host that only looks like a private range', () => {
        expect(companySiteUrl('172.example.com')).toBe('https://172.example.com')
    })

    it('refuses a raw public IP, which has no letters in its top-level label', () => {
        expect(companySiteUrl('8.8.8.8')).toBeNull()
    })

    it('never takes a platform for the company site', () => {
        expect(companySiteUrl('linkedin.com')).toBeNull()
        expect(companySiteUrl('https://m.facebook.com/acme')).toBeNull()
        expect(companySiteUrl('acme.substack.com')).toBe('https://acme.substack.com')
    })
})

describe('scrapeCompanySite', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
        vi.useRealTimers()
    })

    it('does not call the API without a key', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', '')
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await scrapeCompanySite('https://acme.com')).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns the trimmed markdown capped at 15k characters', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { markdown: `  ${'m'.repeat(20_000)}` } })))
        expect(await scrapeCompanySite('https://acme.com')).toBe('m'.repeat(15_000))
    })

    it('retries once after a rate limit', async () => {
        vi.useFakeTimers()
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockResolvedValueOnce(Response.json({ data: { markdown: '# Acme' } }))
        vi.stubGlobal('fetch', fetchMock)
        const pending = scrapeCompanySite('https://acme.com')
        await vi.advanceTimersByTimeAsync(1500)
        expect(await pending).toBe('# Acme')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('degrades every failure to null', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
        expect(await scrapeCompanySite('https://acme.com')).toBeNull()
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { markdown: '   ' } })))
        expect(await scrapeCompanySite('https://acme.com')).toBeNull()
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
        expect(await scrapeCompanySite('https://acme.com')).toBeNull()
    })
})

describe('isPublicUrl', () => {
    it('accepts a public page with its path and query', () => {
        expect(isPublicUrl('https://www.g2.com/products/slack/reviews?page=2')).toBe(true)
        expect(isPublicUrl('http://172.example.com/')).toBe(true)
    })

    it('refuses a private host, a bare name and anything that is not http', () => {
        for (const url of ['http://localhost:3000/', 'http://127.0.0.1/admin', 'http://10.0.0.4/', 'http://192.168.1.10/', 'http://[::1]/', 'http://intranet/', 'ftp://example.com/file', 'not a url']) {
            expect(isPublicUrl(url)).toBe(false)
        }
    })
})

describe('scrapePage', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    it('returns null without a key, and does not call the API', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', '')
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await scrapePage('https://acme.com/pricing')).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns the page markdown and raw HTML with both statuses', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { markdown: '  # Pricing ', rawHtml: '<html><head><title>Pricing</title></head></html>', metadata: { statusCode: 200 } } }))
        vi.stubGlobal('fetch', fetchMock)
        expect(await scrapePage('https://acme.com/pricing')).toEqual({ status: 200, ok: true, markdown: '# Pricing', rawHtml: '<html><head><title>Pricing</title></head></html>', pageStatus: 200 })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://acme.com/pricing', formats: ['markdown', 'rawHtml'], proxy: 'auto' })
    })

    it('fails a block page the scraper rendered faithfully', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { markdown: 'Access denied', metadata: { statusCode: 403 } } })))
        expect(await scrapePage('https://acme.com/')).toMatchObject({ status: 200, ok: false, pageStatus: 403 })
    })

    it('reports the status the scraper refused with', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'we do not support this site' }, { status: 403 })))
        expect(await scrapePage('https://www.yelp.com/biz/x')).toEqual({ status: 403, ok: false, markdown: '', rawHtml: '', pageStatus: null })
    })

    it('reports a null status when the scraper cannot be reached', async () => {
        vi.stubEnv('FIRECRAWL_API_KEY', 'fc')
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
        expect(await scrapePage('https://acme.com/')).toEqual({ status: null, ok: false, markdown: '', rawHtml: '', pageStatus: null })
    })
})
