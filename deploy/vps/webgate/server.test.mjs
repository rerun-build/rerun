import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'

const KEY = 'test-webgate-key'
const crawlCalls = []
let searxUp = true

const page = {
    success: true,
    url: 'https://acme.test',
    html: '<html><head><title>Acme</title></head><body>hi</body></html>',
    links: {
        internal: [
            { href: 'https://acme.test/' },
            { href: 'https://acme.test/pricing#plans' },
            { href: 'https://acme.test/pricing' },
            { href: 'https://www.acme.test/about' },
            { href: 'mailto:hello@acme.test' },
        ],
        external: [{ href: 'https://www.linkedin.com/company/acme' }, { href: 'https://acme.test/' }],
    },
    metadata: { title: 'Acme' },
    status_code: 200,
    redirected_url: 'https://acme.test/',
    markdown: { raw_markdown: '# Nav\n\n# Acme\n\nhi', fit_markdown: '# Acme\n\nhi' },
}

async function listen(handler) {
    const server = createServer(handler).listen(0, '127.0.0.1')
    await once(server, 'listening')
    return { server, url: `http://127.0.0.1:${server.address().port}` }
}

const fakeCrawl4ai = await listen(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    crawlCalls.push({ auth: req.headers.authorization, path: req.url, body })
    const target = body.urls[0]
    res.setHeader('content-type', 'application/json')
    if (target.includes('down')) return res.writeHead(500).end(JSON.stringify({ detail: 'browser crashed' }))
    if (target.includes('blocked')) return res.end(JSON.stringify({ success: true, results: [{ success: false, error_message: 'net::ERR_NAME_NOT_RESOLVED' }] }))
    if (target.includes('missing')) return res.end(JSON.stringify({ success: true, results: [{ ...page, status_code: 404 }] }))
    res.end(JSON.stringify({ success: true, results: [page] }))
})

const fakeSearxng = await listen((req, res) => {
    if (!searxUp) return res.writeHead(503).end('down')
    const url = new URL(req.url, 'http://x')
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('format'), 'json')
    const results = Array.from({ length: 25 }, (_, i) => ({ url: `https://r${i}.test/`, title: `R${i} ${url.searchParams.get('q')}`, content: `snippet ${i}` }))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ query: url.searchParams.get('q'), results: [{ title: 'no url' }, ...results] }))
})

process.env.WEBGATE_KEY = KEY
process.env.CRAWL4AI_URL = fakeCrawl4ai.url
process.env.CRAWL4AI_TOKEN = 'test-crawl4ai-token'
process.env.SEARXNG_URL = fakeSearxng.url
const { handle } = await import('./server.mjs')
const gate = await listen(handle)

const post = (path, body, headers = { authorization: `Bearer ${KEY}` }) =>
    fetch(`${gate.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('webgate', () => {
    before(() => {
        console.log = () => {}
    })
    beforeEach(() => {
        crawlCalls.length = 0
        searxUp = true
    })
    after(() => {
        for (const { server } of [gate, fakeCrawl4ai, fakeSearxng]) server.close()
    })

    it('answers 401 without the key, with a wrong key, and on unknown paths', async () => {
        assert.equal((await post('/v2/scrape', { url: 'https://acme.test' }, {})).status, 401)
        assert.equal((await post('/v2/scrape', { url: 'https://acme.test' }, { authorization: 'Bearer nope' })).status, 401)
        assert.equal((await fetch(`${gate.url}/res/v1/web/search?q=x`, { headers: { 'X-Subscription-Token': 'nope' } })).status, 401)
        assert.equal((await fetch(`${gate.url}/anything`)).status, 401)
        assert.equal(crawlCalls.length, 0)
    })

    it('refuses to start without WEBGATE_KEY', () => {
        const run = spawnSync(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env: { ...process.env, WEBGATE_KEY: '' }, encoding: 'utf8', timeout: 10_000 })
        assert.equal(run.status, 1)
        assert.match(run.stderr, /WEBGATE_KEY is not set/)
    })

    it('scrapes main-content markdown by default, with metadata and the crawl4ai token', async () => {
        const res = await post('/v2/scrape', { url: 'https://acme.test', formats: ['markdown'], onlyMainContent: true })
        assert.equal(res.status, 200)
        assert.deepEqual(await res.json(), {
            success: true,
            data: { markdown: '# Acme\n\nhi', metadata: { title: 'Acme', sourceURL: 'https://acme.test', url: 'https://acme.test/', statusCode: 200, creditsUsed: 0 } },
        })
        assert.equal(crawlCalls[0].auth, 'Bearer test-crawl4ai-token')
        assert.equal(crawlCalls[0].path, '/crawl')
        assert.deepEqual(crawlCalls[0].body.urls, ['https://acme.test'])
    })

    it('scrapes the whole page, raw HTML and every link when asked', async () => {
        const body = await (await post('/v2/scrape', { url: 'https://acme.test', formats: ['markdown', 'rawHtml', 'links'], onlyMainContent: false })).json()
        assert.equal(body.data.markdown, '# Nav\n\n# Acme\n\nhi')
        assert.equal(body.data.rawHtml, page.html)
        assert.deepEqual(body.data.links, ['https://acme.test/', 'https://acme.test/pricing#plans', 'https://acme.test/pricing', 'https://www.acme.test/about', 'https://www.linkedin.com/company/acme'])
    })

    it('reports the page status of a page that answered 404 as a successful scrape', async () => {
        const res = await post('/v2/scrape', { url: 'https://acme.test/missing', formats: ['markdown', 'rawHtml'] })
        assert.equal(res.status, 200)
        assert.equal((await res.json()).data.metadata.statusCode, 404)
    })

    it('fails with 502 and a reason when crawl4ai fails or cannot read the page', async () => {
        const down = await post('/v2/scrape', { url: 'https://down.test' })
        assert.equal(down.status, 502)
        assert.deepEqual(await down.json(), { success: false, error: 'crawl4ai answered 500: browser crashed' })
        const blocked = await post('/v2/map', { url: 'https://blocked.test' })
        assert.equal(blocked.status, 502)
        assert.match((await blocked.json()).error, /ERR_NAME_NOT_RESOLVED/)
    })

    it('refuses private and non-http targets without calling crawl4ai', async () => {
        for (const url of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.2/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://metadata.google.internal/', 'http://100.100.1.1/', 'file:///etc/passwd', 'not a url']) {
            const res = await post('/v2/scrape', { url })
            assert.equal(res.status, 400, url)
            assert.equal((await res.json()).success, false)
        }
        assert.equal((await post('/v2/map', { url: 'http://10.1.2.3' })).status, 400)
        assert.equal(crawlCalls.length, 0)
    })

    it('answers a branding-only scrape with 400 without crawling', async () => {
        assert.equal((await post('/v2/scrape', { url: 'https://acme.test', formats: ['branding'] })).status, 400)
        assert.equal(crawlCalls.length, 0)
    })

    it('maps the same-site links of the start page, deduplicated and capped', async () => {
        const body = await (await post('/v2/map', { url: 'https://acme.test', limit: 500 })).json()
        assert.deepEqual(body, { success: true, links: [{ url: 'https://acme.test/' }, { url: 'https://acme.test/pricing' }, { url: 'https://www.acme.test/about' }], creditsUsed: 0 })
        const capped = await (await post('/v2/map', { url: 'https://acme.test', limit: 2 })).json()
        assert.equal(capped.links.length, 2)
    })

    it('searches through SearXNG in Firecrawl shape', async () => {
        const body = await (await post('/v2/search', { query: 'acme press', limit: 3 })).json()
        assert.deepEqual(body, {
            success: true,
            data: {
                web: [
                    { url: 'https://r0.test/', title: 'R0 acme press', description: 'snippet 0' },
                    { url: 'https://r1.test/', title: 'R1 acme press', description: 'snippet 1' },
                    { url: 'https://r2.test/', title: 'R2 acme press', description: 'snippet 2' },
                ],
            },
            creditsUsed: 0,
        })
        assert.equal((await post('/v2/search', { limit: 3 })).status, 400)
    })

    it('searches through SearXNG in Brave shape with the subscription token', async () => {
        const res = await fetch(`${gate.url}/res/v1/web/search?q=${encodeURIComponent('a & b')}&count=2`, { headers: { Accept: 'application/json', 'X-Subscription-Token': KEY } })
        assert.equal(res.status, 200)
        const body = await res.json()
        assert.deepEqual(body.web.results, [
            { title: 'R0 a & b', url: 'https://r0.test/', description: 'snippet 0' },
            { title: 'R1 a & b', url: 'https://r1.test/', description: 'snippet 1' },
        ])
        const capped = await (await fetch(`${gate.url}/res/v1/web/search?q=x&count=50`, { headers: { 'X-Subscription-Token': KEY } })).json()
        assert.equal(capped.web.results.length, 20)
    })

    it('fails with 502 when SearXNG is down, so Rerun reports the provider failure', async () => {
        searxUp = false
        assert.equal((await fetch(`${gate.url}/res/v1/web/search?q=x&count=5`, { headers: { 'X-Subscription-Token': KEY } })).status, 502)
        const res = await post('/v2/search', { query: 'x', limit: 5 })
        assert.equal(res.status, 502)
        assert.deepEqual(await res.json(), { success: false, error: 'SearXNG answered 503' })
    })
})
