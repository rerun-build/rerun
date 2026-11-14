import { firecrawl } from '../firecrawl'
import { fetchPublic } from './public-fetch'
import { mapWithConcurrency, productUrlsOf } from './site'
import { CollectorSkipped, type Collector } from './types'

export const MAX_CATALOG_PRODUCTS = 25
const MAX_DESCRIPTION = 2_000
const SHOPIFY_PAGE_SIZE = 250
const SHOPIFY_MAX_PAGES = 4
const WOO_PAGE_SIZE = 100
const SCRAPED_PRODUCTS = 8
const SCRAPE_CONCURRENCY = 2
const FETCH_CONCURRENCY = 4
const MAX_HTML = 2_000_000
const MAX_COLLECTIONS = 20
const MAX_COLLECTION_TITLE = 60
const CATCH_ALL_SHARE = 0.8
const MIN_PRODUCT_URLS = 3
const FETCH_TIMEOUT_MS = 15_000

export type CatalogProduct = {
    name: string
    url: string
    image: string | null
    category: string | null
    tags: string[]
    description: string
}

export type CatalogFindings = {
    platform: string | null
    shopUrl: string
    total: number | null
    totalIsLowerBound: boolean
    collections: string[]
    products: CatalogProduct[]
}

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    laquo: '«',
    raquo: '»',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    euro: '€',
    eacute: 'é',
    egrave: 'è',
    ecirc: 'ê',
    agrave: 'à',
    acirc: 'â',
    ccedil: 'ç',
    ocirc: 'ô',
    ucirc: 'û',
    icirc: 'î',
}

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
        if (code[0] === '#') {
            const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
            return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
        }
        return ENTITIES[code.toLowerCase()] ?? entity
    })
}

export function htmlToText(html: string): string {
    const text = html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/(p|div|ul|ol|h[1-6]|tr|table|section)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    return decodeEntities(text)
        .replace(/[ \t ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text
    const cut = text.slice(0, max)
    const lastSpace = cut.lastIndexOf(' ')
    return `${(lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function absolute(href: string | null | undefined, base: string): string | null {
    if (!href) return null
    try {
        const url = new URL(href.startsWith('//') ? `https:${href}` : href, base)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
    } catch {
        return null
    }
}

function productKey(url: string): string {
    try {
        const segments = new URL(url).pathname.split('/').filter(Boolean)
        return decodeURIComponent(segments[segments.length - 1] ?? '').toLowerCase()
    } catch {
        return ''
    }
}

export type ShopifyProduct = {
    title?: string
    handle?: string
    body_html?: string | null
    product_type?: string | null
    tags?: string[] | string
    images?: { src?: string }[]
}

export function readShopifyProduct(product: ShopifyProduct, shopUrl: string): CatalogProduct | null {
    const name = product.title?.trim()
    if (!name || !product.handle) return null
    const tags = Array.isArray(product.tags) ? product.tags : (product.tags ?? '').split(',')
    return {
        name,
        url: new URL(`/products/${product.handle}`, shopUrl).toString(),
        image: absolute(product.images?.[0]?.src, shopUrl),
        category: product.product_type?.trim() || null,
        tags: tags.map(tag => tag.trim()).filter(Boolean),
        description: truncate(htmlToText(product.body_html ?? ''), MAX_DESCRIPTION),
    }
}

export type WooProduct = {
    name?: string
    permalink?: string
    description?: string | null
    short_description?: string | null
    categories?: { name?: string }[]
    tags?: { name?: string }[]
    images?: { src?: string }[]
}

export function readWooProduct(product: WooProduct, shopUrl: string): CatalogProduct | null {
    const name = product.name ? htmlToText(product.name) : ''
    const url = absolute(product.permalink, shopUrl)
    if (!name || !url) return null
    return {
        name,
        url,
        image: absolute(product.images?.[0]?.src, shopUrl),
        category: product.categories?.map(category => category.name?.trim()).find(Boolean) ?? null,
        tags: (product.tags ?? []).map(tag => tag.name?.trim() ?? '').filter(Boolean),
        description: truncate(htmlToText(product.description || product.short_description || ''), MAX_DESCRIPTION),
    }
}

export function rankProducts(products: CatalogProduct[], featuredUrls: string[]): CatalogProduct[] {
    const rank = new Map<string, number>()
    for (const url of featuredUrls) {
        const key = productKey(url)
        if (key && !rank.has(key)) rank.set(key, rank.size)
    }
    const seen = new Set<string>()
    return products
        .map((product, index) => ({ product, index, rank: rank.get(productKey(product.url)) ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(({ product }) => product)
        .filter(product => {
            const keys = [`url:${productKey(product.url)}`, `name:${product.name.toLowerCase()}`]
            if (keys.some(key => seen.has(key))) return false
            keys.forEach(key => seen.add(key))
            return true
        })
}

async function fetchJson<T>(url: string): Promise<{ data: T; headers: Headers } | null> {
    try {
        const res = await fetchPublic(url, { accept: 'application/json', timeoutMs: FETCH_TIMEOUT_MS })
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
        return { data: (await res.json()) as T, headers: res.headers }
    } catch {
        return null
    }
}

async function fetchProductLinks(url: string, shopUrl: string): Promise<string[]> {
    try {
        const res = await fetchPublic(url, { accept: 'text/html', timeoutMs: FETCH_TIMEOUT_MS })
        if (!res.ok) return []
        const html = await res.text()
        return productUrlsOf(
            [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]),
            shopUrl
        )
    } catch {
        return []
    }
}

type PlatformCatalog = { total: number | null; totalIsLowerBound: boolean; collections: string[]; products: CatalogProduct[]; bestSellers: string[] }

async function readShopify(shopUrl: string): Promise<PlatformCatalog | null> {
    const products: CatalogProduct[] = []
    let lastPageFull = false
    for (let page = 1; page <= SHOPIFY_MAX_PAGES; page++) {
        const result = await fetchJson<{ products?: ShopifyProduct[] }>(new URL(`/products.json?limit=${SHOPIFY_PAGE_SIZE}&page=${page}`, shopUrl).toString())
        if (!result || !Array.isArray(result.data.products)) {
            if (page === 1) return null
            break
        }
        const batch = result.data.products
        products.push(...batch.map(product => readShopifyProduct(product, shopUrl)).filter((product): product is CatalogProduct => product !== null))
        lastPageFull = batch.length === SHOPIFY_PAGE_SIZE
        if (!lastPageFull) break
    }
    const [collections, bestSellers] = await Promise.all([
        fetchJson<{ collections?: { title?: string; products_count?: number }[] }>(new URL(`/collections.json?limit=${SHOPIFY_PAGE_SIZE}`, shopUrl).toString()),
        fetchProductLinks(new URL('/collections/all?sort_by=best-selling', shopUrl).toString(), shopUrl),
    ])
    return {
        total: products.length,
        totalIsLowerBound: lastPageFull,
        collections: (collections?.data.collections ?? [])
            .filter(collection => collection.products_count !== 0 && (collection.products_count ?? 0) < products.length * CATCH_ALL_SHARE && (collection.title ?? '').length <= MAX_COLLECTION_TITLE)
            .sort((a, b) => (b.products_count ?? 0) - (a.products_count ?? 0))
            .map(collection => collection.title?.trim() ?? '')
            .filter(Boolean)
            .slice(0, MAX_COLLECTIONS),
        products,
        bestSellers,
    }
}

async function readWooCommerce(shopUrl: string): Promise<PlatformCatalog | null> {
    const [list, categories] = await Promise.all([
        fetchJson<WooProduct[]>(new URL(`/wp-json/wc/store/v1/products?per_page=${WOO_PAGE_SIZE}&orderby=popularity&order=desc`, shopUrl).toString()),
        fetchJson<{ name?: string }[]>(new URL(`/wp-json/wc/store/v1/products/categories?per_page=${WOO_PAGE_SIZE}`, shopUrl).toString()),
    ])
    if (!list || !Array.isArray(list.data)) return null
    const products = list.data.map(product => readWooProduct(product, shopUrl)).filter((product): product is CatalogProduct => product !== null)
    const headerTotal = Number(list.headers.get('x-wp-total'))
    return {
        total: Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : products.length,
        totalIsLowerBound: !(Number.isFinite(headerTotal) && headerTotal > 0) && products.length === WOO_PAGE_SIZE,
        collections: Array.isArray(categories?.data)
            ? categories.data
                  .map(category => htmlToText(category.name ?? ''))
                  .filter(category => category && !/^uncategori[sz]ed$|^non class/i.test(category))
                  .slice(0, MAX_COLLECTIONS)
            : [],
        products,
        bestSellers: [],
    }
}

type ProductLd = { '@type'?: string | string[]; name?: string; description?: string; image?: unknown; category?: unknown; url?: string; offers?: { url?: string } | { url?: string }[] }

function isProductLd(node: unknown): node is ProductLd {
    if (!node || typeof node !== 'object') return false
    const type = (node as ProductLd)['@type']
    return (Array.isArray(type) ? type : [type]).some(entry => entry === 'Product' || entry === 'ProductGroup')
}

function findProductLd(node: unknown): ProductLd | null {
    if (Array.isArray(node)) {
        for (const entry of node) {
            const found = findProductLd(entry)
            if (found) return found
        }
        return null
    }
    if (isProductLd(node)) return node
    return node && typeof node === 'object' && '@graph' in node ? findProductLd((node as { '@graph': unknown })['@graph']) : null
}

function firstImage(image: unknown): string | null {
    if (typeof image === 'string') return image
    if (Array.isArray(image)) return firstImage(image[0])
    if (image && typeof image === 'object' && 'url' in image) return firstImage((image as { url: unknown }).url)
    return null
}

function metaProperty(html: string, key: string): string | null {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i'))?.[0]
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1]?.trim()
    return content ? decodeEntities(content) : null
}

function withoutSiteName(title: string, siteName: string | null): string {
    if (!siteName) return title
    const parts = title.split(/\s+[—–|-]\s+/)
    return parts.length > 1 && parts[parts.length - 1].trim().toLowerCase() === siteName.toLowerCase() ? parts.slice(0, -1).join(' — ') : title
}

export function readProductPage(html: string, url: string): CatalogProduct | null {
    let product: ProductLd | null = null
    for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            product = findProductLd(JSON.parse(match[1]))
        } catch {
            continue
        }
        if (product) break
    }
    const name = (product?.name ? htmlToText(product.name) : '') || withoutSiteName(metaProperty(html, 'og:title') ?? '', metaProperty(html, 'og:site_name'))
    if (!name) return null
    const category = typeof product?.category === 'string' && product.category !== 'general' ? product.category : null
    return {
        name,
        url,
        image: absolute(firstImage(product?.image) ?? metaProperty(html, 'og:image'), url),
        category,
        tags: [],
        description: truncate(htmlToText(product?.description ?? metaProperty(html, 'og:description') ?? metaProperty(html, 'description') ?? ''), MAX_DESCRIPTION),
    }
}

async function fetchProductPage(url: string): Promise<CatalogProduct | null> {
    try {
        const res = await fetchPublic(url, { accept: 'text/html', timeoutMs: FETCH_TIMEOUT_MS })
        return res.ok ? readProductPage((await res.text()).slice(0, MAX_HTML), url) : null
    } catch {
        return null
    }
}

type RawHtmlResponse = { data?: { rawHtml?: string; metadata?: { creditsUsed?: number } } }

async function readProductPages(urls: string[]): Promise<{ products: CatalogProduct[]; credits: number }> {
    const fetched = (await mapWithConcurrency(urls.slice(0, MAX_CATALOG_PRODUCTS), FETCH_CONCURRENCY, fetchProductPage)).filter((product): product is CatalogProduct => product !== null)
    if (fetched.length) return { products: fetched, credits: 0 }

    let credits = 0
    const scraped = await mapWithConcurrency(urls.slice(0, SCRAPED_PRODUCTS), SCRAPE_CONCURRENCY, async url => {
        try {
            const page = await firecrawl<RawHtmlResponse>('/v2/scrape', { url, formats: ['rawHtml'] }, 45_000)
            credits += page.data?.metadata?.creditsUsed ?? 1
            return page.data?.rawHtml ? readProductPage(page.data.rawHtml, url) : null
        } catch {
            return null
        }
    })
    return { products: scraped.filter((product): product is CatalogProduct => product !== null), credits }
}

const PLATFORM_READERS: Record<string, (shopUrl: string) => Promise<PlatformCatalog | null>> = {
    Shopify: readShopify,
    WooCommerce: readWooCommerce,
}

export const catalogCollector: Collector<'catalog'> = {
    id: 'catalog',
    needs: ['stack', 'site'],
    async run({ input, need }) {
        const [stack, site] = await Promise.all([need('stack'), need('site')])
        const shopUrl = new URL(stack?.finalUrl ?? input.url).origin
        const detected = stack?.technologies.find(tech => tech.category === 'E-commerce')?.name ?? null
        const productUrls = site?.productUrls ?? []
        if (stack && !detected && productUrls.length < MIN_PRODUCT_URLS) throw new CollectorSkipped('Pas de boutique en ligne')

        const candidates = detected ? [detected] : stack ? [] : Object.keys(PLATFORM_READERS)
        let platform: string | null = detected
        let catalog: PlatformCatalog | null = null
        for (const candidate of candidates) {
            const reader = PLATFORM_READERS[candidate]
            catalog = reader ? await reader(shopUrl) : null
            if (catalog) {
                platform = candidate
                break
            }
        }

        let credits = 0
        if (!catalog) {
            if (productUrls.length < MIN_PRODUCT_URLS) throw new CollectorSkipped(detected ? `Boutique ${detected}, mais aucune fiche produit trouvée` : 'Pas de boutique en ligne')
            const featured = [...new Set([...(site?.homeProductUrls ?? []), ...productUrls])]
            const read = await readProductPages(featured)
            credits = read.credits
            catalog = { total: productUrls.length, totalIsLowerBound: true, collections: [], products: read.products, bestSellers: [] }
        }

        const products = rankProducts(catalog.products, [...(site?.homeProductUrls ?? []), ...catalog.bestSellers]).slice(0, MAX_CATALOG_PRODUCTS)
        if (!products.length) throw new CollectorSkipped('Aucune fiche produit lisible')

        const data: CatalogFindings = { platform, shopUrl, total: catalog.total, totalIsLowerBound: catalog.totalIsLowerBound, collections: catalog.collections, products }
        return {
            data,
            cost: { firecrawlCredits: credits },
            highlights: [
                `${platform ?? 'Plateforme inconnue'} : ${data.total ?? '?'}${data.totalIsLowerBound ? '+' : ''} produits`,
                `${products.length} fiche(s) gardée(s) : ${products
                    .slice(0, 5)
                    .map(product => product.name)
                    .join(', ')}${products.length > 5 ? '…' : ''}`,
                data.collections.length ? `Collections : ${data.collections.slice(0, 8).join(', ')}` : 'Aucune collection lue',
            ],
        }
    },
}
