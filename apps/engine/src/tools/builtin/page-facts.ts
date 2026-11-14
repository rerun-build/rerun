const MAX_H1 = 3
const MAX_H1_CHARS = 120
const MAX_HREFLANG = 15
const MAX_LINKS_LISTED = 30

export type PageSource = 'served' | 'rendered'

type PageFactsOptions = { url: string; source: PageSource; xRobotsTag?: string | null; redirectedTo?: string | null }

type Attributes = Record<string, string>

export function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function codePointOrText(entity: string, code: number): string {
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity
}

function decodeEntities(text: string): string {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => codePointOrText(entity, parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (entity, dec: string) => codePointOrText(entity, Number(dec)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
}

function textOf(html: string): string {
    return decodeEntities(stripHtml(html))
}

function attributesOf(tag: string): Attributes {
    const attributes: Attributes = {}
    for (const [, name, doubleQuoted, singleQuoted, bare] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
        attributes[name.toLowerCase()] = decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? '').trim()
    }
    return attributes
}

function tagsNamed(html: string, name: string): Attributes[] {
    return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) => attributesOf(tag))
}

function relIncludes(attributes: Attributes, rel: string): boolean {
    return (attributes.rel ?? '').toLowerCase().split(/\s+/).includes(rel)
}

function sameSite(a: URL, b: URL): boolean {
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '')
}

function resolveUrl(href: string, base: URL): URL | null {
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return null
    try {
        const url = new URL(href, base)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch {
        return null
    }
}

function shortUrl(url: URL, base: URL): string {
    return sameSite(url, base) ? `${url.pathname}${url.search}` : url.href
}

function jsonLdTypes(html: string): string[] {
    const types = new Set<string>()
    const collect = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(collect)
        if (!node || typeof node !== 'object') return
        const record = node as Record<string, unknown>
        const type = record['@type']
        for (const value of Array.isArray(type) ? type : [type]) if (typeof value === 'string') types.add(value)
        collect(record['@graph'])
    }
    for (const [, json] of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            collect(JSON.parse(json))
        } catch {
            continue
        }
    }
    return [...types]
}

function chromeLinks(html: string, base: URL): string[] {
    const paths = new Set<string>()
    for (const [region] of html.matchAll(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi)) {
        for (const { href } of tagsNamed(region, 'a')) {
            const url = resolveUrl(href ?? '', base)
            if (url && sameSite(url, base)) paths.add(`${url.pathname}${url.search}`)
        }
    }
    return [...paths]
}

function listed(items: string[], max: number): string {
    return items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max} more)` : items.join(', ')
}

export function pageFacts(html: string, { url, source, xRobotsTag, redirectedTo }: PageFactsOptions): string | null {
    let base: URL
    try {
        base = new URL(redirectedTo || url)
    } catch {
        return null
    }

    const meta = tagsNamed(html, 'meta')
    const metaContent = (name: string) => meta.find(m => (m.name ?? m.property ?? '').toLowerCase() === name)?.content || null
    const links = tagsNamed(html, 'link')

    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? textOf(titleMatch[1]) : null
    const description = metaContent('description')
    const canonicalHref = links.find(l => relIncludes(l, 'canonical'))?.href
    const canonical = canonicalHref ? resolveUrl(canonicalHref, base)?.href ?? canonicalHref : null
    const robots = [
        ['meta robots', metaContent('robots')],
        ['meta googlebot', metaContent('googlebot')],
        ['X-Robots-Tag', xRobotsTag ?? null],
    ].flatMap(([label, value]) => (value ? [`${label}: ${value}`] : []))
    const htmlTag = html.match(/<html\b[^>]*>/i)?.[0]
    const lang = htmlTag ? attributesOf(htmlTag).lang || null : null
    const hreflang = links
        .filter(l => relIncludes(l, 'alternate') && l.hreflang && l.href)
        .map(l => {
            const target = resolveUrl(l.href, base)
            return `${l.hreflang} → ${target ? shortUrl(target, base) : l.href}`
        })
    const types = jsonLdTypes(html)
    const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(([, inner]) => textOf(inner).slice(0, MAX_H1_CHARS)).filter(Boolean)

    const anchors = new Set<string>()
    const internalPaths = new Set<string>()
    let external = 0
    for (const { href } of tagsNamed(html, 'a')) {
        const target = resolveUrl(href ?? '', base)
        if (!target || anchors.has(target.href)) continue
        anchors.add(target.href)
        if (sameSite(target, base)) internalPaths.add(`${target.pathname}${target.search}`)
        else external++
    }
    const chrome = chromeLinks(html, base)
    const otherInternal = [...internalPaths].filter(path => !chrome.includes(path))

    if (!title && !description && !canonical && !robots.length && !lang && !hreflang.length && !types.length && !h1.length && !anchors.size) return null

    const lines = [
        source === 'served' ? 'Page facts (HTML as served, before JavaScript):' : 'Page facts (HTML after JavaScript, read through Rerun):',
        `title: ${title || 'none'}`,
        `description: ${description ?? 'none'}`,
        `canonical: ${canonical ?? 'none'}`,
        `robots: ${robots.length ? robots.join('; ') : 'none set'}`,
        `lang: ${lang ?? 'none'}`,
        `hreflang: ${hreflang.length ? listed(hreflang, MAX_HREFLANG) : 'none'}`,
        `JSON-LD: ${types.length ? types.join(', ') : 'none'}`,
        `h1: ${h1.length ? listed(h1.map(h => `"${h}"`), MAX_H1) : 'none'}`,
    ]
    if (redirectedTo && redirectedTo !== url) lines.push(`redirected to: ${redirectedTo}`)
    lines.push(`links: ${internalPaths.size} internal, ${external} external`)
    lines.push(`nav/header/footer links: ${chrome.length ? listed(chrome, MAX_LINKS_LISTED) : 'none'}`)
    lines.push(`other internal links: ${otherInternal.length ? listed(otherInternal, MAX_LINKS_LISTED) : 'none'}`)
    lines.push(`visible text: ${stripHtml(html).length} chars`)
    return lines.join('\n')
}
