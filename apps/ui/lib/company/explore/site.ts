import { firecrawl } from '../firecrawl'
import { linkedinPeople, socialProfiles, type SocialProfiles } from './social'
import type { Collector } from './types'

export const PAGE_CATEGORIES = ['about', 'team', 'pricing', 'customers', 'product', 'legal', 'careers', 'contact', 'privacy', 'blog'] as const
export type PageCategory = (typeof PAGE_CATEGORIES)[number]

const CATEGORY_PATTERNS: Record<PageCategory, RegExp> = {
    about: /(^|\/)(about|about-us|a-propos|qui-sommes-nous|notre-histoire|our-story|company|entreprise|histoire)(\/|$)/i,
    team: /(^|\/)(team|equipe|l-equipe|our-team|people|founders|fondateurs)(\/|$)/i,
    pricing: /(^|\/)(pricing|prices|tarifs?|prix|plans|offres?|abonnements?)(\/|$)/i,
    customers: /(^|\/)(customers|clients|case-stud(y|ies)|cas-clients?|testimonials|temoignages|references|success-stories)(\/|$)/i,
    product: /(^|\/)(products?|produits?|shop|boutique|store|collections|catalogue|catalog|features|fonctionnalites|solutions?|services?|platform|plateforme)(\/|$)/i,
    legal: /(^|\/)(mentions-legales|legal-notice|legal|imprint|impressum|cgv|cgu)(\/|$)/i,
    careers: /(^|\/)(careers|jobs|recrutement|carrieres|join-us|rejoignez-nous|nous-rejoindre)(\/|$)/i,
    contact: /(^|\/)(contact|contactez-nous|contact-us|nous-contacter)(\/|$)/i,
    privacy: /(^|\/)(privacy|privacy-policy|confidentialite|politique-de-confidentialite|rgpd|gdpr|dpa)(\/|$)/i,
    blog: /(^|\/)(blog|actualites|news|journal|insights|articles)(\/|$)/i,
}

const MAX_PAGES = 8
const MAX_PRODUCT_URLS = 200
const PRODUCT_URL = /(^|\/)(products?|produits?)\/[^/]+\/?$/i
const SCRAPE_CONCURRENCY = 4
const MAX_PAGE_MARKDOWN = 12_000
const PAGE_TIMEOUT_MS = 45_000

export type SitePage = { category: PageCategory | 'home'; url: string; title: string | null; markdown: string }

export type SiteFindings = {
    mappedUrls: number
    pages: SitePage[]
    homeProductUrls: string[]
    productUrls: string[]
    failedPages: { url: string; error: string }[]
    social: SocialProfiles
    linkedinPeople: string[]
    branding: SiteBranding | null
}

export type SiteBranding = {
    colorScheme: string | null
    colors: Record<string, string>
    fonts: string[]
    logo: string | null
    favicon: string | null
    ogImage: string | null
}

function samesite(url: URL, home: URL): boolean {
    return url.hostname.replace(/^www\./, '') === home.hostname.replace(/^www\./, '')
}

export function pickPages(urls: string[], homeUrl: string): { category: PageCategory; url: string }[] {
    const home = new URL(homeUrl)
    const picked: { category: PageCategory; url: string }[] = []
    for (const category of PAGE_CATEGORIES) {
        const candidates = urls
            .map(raw => {
                try {
                    return new URL(raw)
                } catch {
                    return null
                }
            })
            .filter((url): url is URL => url !== null && samesite(url, home) && CATEGORY_PATTERNS[category].test(url.pathname))
            .filter(url => !picked.some(page => page.url === url.toString()))
            .sort((a, b) => a.pathname.split('/').length - b.pathname.split('/').length || a.pathname.length - b.pathname.length)
        if (candidates[0]) picked.push({ category, url: candidates[0].toString() })
        if (picked.length === MAX_PAGES) break
    }
    return picked
}

export function productUrlsOf(links: string[], homeUrl: string): string[] {
    const home = new URL(homeUrl)
    const urls = new Set<string>()
    for (const raw of links) {
        let url: URL
        try {
            url = new URL(raw, home)
        } catch {
            continue
        }
        if (!samesite(url, home) || !PRODUCT_URL.test(url.pathname)) continue
        urls.add(`${url.origin}${url.pathname.replace(/\/$/, '')}`)
        if (urls.size === MAX_PRODUCT_URLS) break
    }
    return [...urls]
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await task(items[index])
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

type ScrapeResponse = {
    data?: {
        markdown?: string
        links?: string[]
        branding?: { colorScheme?: string; colors?: Record<string, string>; fonts?: { family?: string }[]; images?: { logo?: string; favicon?: string; ogImage?: string } }
        metadata?: { title?: string; creditsUsed?: number }
    }
}

function keepUrl(value: string | undefined): string | null {
    if (!value) return null
    return value.startsWith('http') || (value.startsWith('data:') && value.length < 40_000) ? value : null
}

function readBranding(branding: NonNullable<ScrapeResponse['data']>['branding']): SiteBranding | null {
    if (!branding) return null
    return {
        colorScheme: branding.colorScheme ?? null,
        colors: branding.colors ?? {},
        fonts: [...new Set((branding.fonts ?? []).map(font => font.family).filter((family): family is string => Boolean(family)))],
        logo: keepUrl(branding.images?.logo),
        favicon: keepUrl(branding.images?.favicon),
        ogImage: keepUrl(branding.images?.ogImage),
    }
}

export const siteCollector: Collector<'site'> = {
    id: 'site',
    needs: [],
    async run({ input }) {
        let credits = 0

        const [map, home, branding] = await Promise.all([
            firecrawl<{ links?: { url: string }[]; creditsUsed?: number }>('/v2/map', { url: input.url, limit: 500 }, 30_000).catch(() => ({ links: [], creditsUsed: 0 })),
            firecrawl<ScrapeResponse>('/v2/scrape', { url: input.url, formats: ['markdown', 'links'], onlyMainContent: false }, PAGE_TIMEOUT_MS),
            firecrawl<ScrapeResponse>('/v2/scrape', { url: input.url, formats: ['branding'] }, 90_000).catch(() => null),
        ])
        credits += (map.creditsUsed ?? 1) + (home.data?.metadata?.creditsUsed ?? 1) + (branding ? (branding.data?.metadata?.creditsUsed ?? 1) : 0)

        const mapped = (map.links ?? []).map(link => link.url)
        const homeLinks = home.data?.links ?? []
        const targets = pickPages([...mapped, ...homeLinks], input.url)

        const failedPages: SiteFindings['failedPages'] = []
        const scraped = await mapWithConcurrency(targets, SCRAPE_CONCURRENCY, async ({ category, url }) => {
            try {
                const page = await firecrawl<ScrapeResponse>('/v2/scrape', { url, formats: ['markdown'], onlyMainContent: true }, PAGE_TIMEOUT_MS)
                credits += page.data?.metadata?.creditsUsed ?? 1
                const markdown = page.data?.markdown?.trim()
                return markdown ? { category, url, title: page.data?.metadata?.title ?? null, markdown: markdown.slice(0, MAX_PAGE_MARKDOWN) } : null
            } catch (error) {
                failedPages.push({ url, error: error instanceof Error ? error.message : String(error) })
                return null
            }
        })

        const pages: SitePage[] = [
            { category: 'home', url: input.url, title: home.data?.metadata?.title ?? null, markdown: (home.data?.markdown ?? '').trim().slice(0, MAX_PAGE_MARKDOWN) },
            ...scraped.filter((page): page is NonNullable<typeof page> => page !== null),
        ]
        const data: SiteFindings = {
            mappedUrls: mapped.length,
            pages,
            homeProductUrls: productUrlsOf(homeLinks, input.url),
            productUrls: productUrlsOf([...homeLinks, ...mapped], input.url),
            failedPages,
            social: socialProfiles(homeLinks),
            linkedinPeople: linkedinPeople([...homeLinks, ...pages.flatMap(page => [...page.markdown.matchAll(/https?:\/\/[^\s)"'\]]+/g)].map(match => match[0]))]),
            branding: readBranding(branding?.data?.branding),
        }

        return {
            data,
            cost: { firecrawlCredits: credits },
            highlights: [
                `${mapped.length} URLs dans le plan du site, ${pages.length} pages lues : ${pages.map(page => page.category).join(', ')}`,
                Object.keys(data.social).length ? `Réseaux : ${Object.keys(data.social).join(', ')}` : 'Aucun réseau social en lien',
                data.linkedinPeople.length ? `${data.linkedinPeople.length} profil(s) LinkedIn de personnes cités` : 'Aucun profil LinkedIn de personne cité',
                data.branding ? `Couleurs : ${Object.values(data.branding.colors).slice(0, 4).join(' ')} · polices : ${data.branding.fonts.join(', ') || '?'}` : 'Pas de branding extrait',
                ...(failedPages.length ? [`${failedPages.length} page(s) en échec`] : []),
            ],
        }
    },
}
