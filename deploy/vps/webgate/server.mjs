import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const PORT = 8080
const KEY = process.env.WEBGATE_KEY ?? ''
const CRAWL4AI_URL = (process.env.CRAWL4AI_URL || 'https://crawl4ai.robagentic.tech').replace(/\/+$/, '')
const CRAWL4AI_TOKEN = process.env.CRAWL4AI_TOKEN ?? ''
const SEARXNG_URL = (process.env.SEARXNG_URL || 'http://searxng:8080').replace(/\/+$/, '')
const CRAWL_TIMEOUT_MS = 50_000
const SEARCH_TIMEOUT_MS = 8_000
const MAX_BODY = 1_000_000
const MAX_MAP_LINKS = 5_000
const BRAVE_MAX_COUNT = 20
const FORMATS = ['markdown', 'rawHtml', 'links']

const CRAWLER_CONFIG = {
    type: 'CrawlerRunConfig',
    params: {
        cache_mode: 'bypass',
        page_timeout: 30_000,
        markdown_generator: { type: 'DefaultMarkdownGenerator', params: { content_filter: { type: 'PruningContentFilter', params: {} } } },
    },
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?::1\]?$)|\.(internal|local|localhost)\.?$/i

export function isPublicUrl(url) {
    try {
        const { protocol, hostname } = new URL(url)
        return (protocol === 'https:' || protocol === 'http:') && hostname.includes('.') && !PRIVATE_HOST.test(hostname)
    } catch {
        return false
    }
}

class Failure extends Error {
    constructor(status, message) {
        super(message)
        this.status = status
    }
}

const digest = value => createHash('sha256').update(value).digest()

function authorized(req) {
    if (!KEY) return false
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-subscription-token'] ?? '')
    return typeof token === 'string' && token.length > 0 && timingSafeEqual(digest(token), digest(KEY))
}

async function readJson(req) {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BODY) throw new Failure(413, 'Request body too large')
        chunks.push(chunk)
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
        throw new Failure(400, 'Invalid JSON')
    }
}

function publicTarget(url) {
    if (typeof url !== 'string' || !isPublicUrl(url)) throw new Failure(400, 'url must be a public http(s) address')
    return url
}

async function crawl(url) {
    let res
    try {
        res = await fetch(`${CRAWL4AI_URL}/crawl`, {
            method: 'POST',
            headers: { authorization: `Bearer ${CRAWL4AI_TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify({ urls: [url], crawler_config: CRAWLER_CONFIG }),
            signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
        })
    } catch (error) {
        throw new Failure(502, `crawl4ai unreachable: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`)
    }
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Failure(502, `crawl4ai answered ${res.status}${typeof body?.detail === 'string' ? `: ${body.detail.slice(0, 200)}` : ''}`)
    const result = body?.results?.[0]
    if (!result?.success) throw new Failure(502, `crawl4ai could not read the page${result?.error_message ? `: ${String(result.error_message).slice(0, 200)}` : ''}`)
    return result
}

async function searx(query, limit) {
    let res
    try {
        res = await fetch(`${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
    } catch (error) {
        throw new Failure(502, `SearXNG unreachable: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`)
    }
    if (!res.ok) throw new Failure(502, `SearXNG answered ${res.status}`)
    const body = await res.json().catch(() => null)
    return (body?.results ?? []).filter(r => typeof r.url === 'string' && r.url).slice(0, limit).map(r => ({ url: r.url, title: r.title ?? '', description: r.content ?? '' }))
}

const hrefs = list => (Array.isArray(list) ? list.map(link => link?.href).filter(href => typeof href === 'string' && /^https?:/i.test(href)) : [])
const siteOf = hostname => hostname.toLowerCase().replace(/^www\./, '')

async function scrape(body) {
    const url = publicTarget(body.url)
    const asked = Array.isArray(body.formats) ? body.formats.filter(format => typeof format === 'string') : ['markdown']
    const formats = asked.filter(format => FORMATS.includes(format))
    if (formats.length === 0) throw new Failure(400, `Unsupported formats: ${asked.join(', ') || 'none'}`)

    const page = await crawl(url)
    const data = { metadata: { title: page.metadata?.title ?? null, sourceURL: url, url: page.redirected_url ?? url, statusCode: page.status_code ?? null, creditsUsed: 0 } }
    if (formats.includes('markdown')) {
        const md = page.markdown ?? {}
        data.markdown = (body.onlyMainContent === false ? md.raw_markdown : md.fit_markdown || md.raw_markdown) ?? ''
    }
    if (formats.includes('rawHtml')) data.rawHtml = page.html ?? ''
    if (formats.includes('links')) data.links = [...new Set([...hrefs(page.links?.internal), ...hrefs(page.links?.external)])]
    return { success: true, data }
}

async function map(body) {
    const url = publicTarget(body.url)
    const limit = Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, MAX_MAP_LINKS) : MAX_MAP_LINKS
    const page = await crawl(url)
    const site = siteOf(new URL(url).hostname)
    const seen = new Set()
    for (const href of hrefs(page.links?.internal)) {
        try {
            const link = new URL(href)
            if (siteOf(link.hostname) !== site) continue
            link.hash = ''
            seen.add(link.href)
        } catch {}
        if (seen.size >= limit) break
    }
    return { success: true, links: [...seen].map(link => ({ url: link })), creditsUsed: 0 }
}

async function search(body) {
    if (typeof body.query !== 'string' || !body.query.trim()) throw new Failure(400, 'query is required')
    const limit = Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, 100) : 5
    return { success: true, data: { web: await searx(body.query, limit) }, creditsUsed: 0 }
}

async function braveSearch(params) {
    const query = params.get('q') ?? ''
    if (!query.trim()) throw new Failure(422, 'q is required')
    const count = Math.min(Math.max(Number.parseInt(params.get('count') ?? '', 10) || BRAVE_MAX_COUNT, 1), BRAVE_MAX_COUNT)
    const results = await searx(query, count)
    return { type: 'search', web: { type: 'search', results: results.map(r => ({ title: r.title, url: r.url, description: r.description })) } }
}

const ROUTES = {
    'POST /v2/scrape': async req => scrape(await readJson(req)),
    'POST /v2/map': async req => map(await readJson(req)),
    'POST /v2/search': async req => search(await readJson(req)),
    'GET /res/v1/web/search': async (_req, url) => braveSearch(url.searchParams),
}

export async function handle(req, res) {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://webgate')
    let status = 200
    let payload
    let note = ''
    try {
        const route = ROUTES[`${req.method} ${url.pathname}`]
        if (!authorized(req)) throw new Failure(401, 'Unauthorized')
        if (!route) throw new Failure(404, 'Not found')
        payload = await route(req, url)
    } catch (error) {
        status = error instanceof Failure ? error.status : 500
        note = error instanceof Failure ? error.message : 'internal error'
        if (!(error instanceof Failure)) console.error(error)
        payload = { success: false, error: note }
    }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
    console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms${note ? ` ${note}` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!KEY) {
        console.error('WEBGATE_KEY is not set; refusing to start.')
        process.exit(1)
    }
    if (!CRAWL4AI_TOKEN) console.error('CRAWL4AI_TOKEN is not set; crawl4ai will refuse page reads.')
    createServer(handle).listen(PORT, () => console.log(`webgate on :${PORT}, crawl4ai ${CRAWL4AI_URL}, SearXNG ${SEARXNG_URL}`))
    process.on('SIGTERM', () => process.exit(0))
}
