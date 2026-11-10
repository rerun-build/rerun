import { BRAIN_CARD_TYPES, FOREMAN_AGENT_ID, type BrainPageType } from '@rerun/contracts'

export const isCardType = (type: BrainPageType) => (BRAIN_CARD_TYPES as readonly string[]).includes(type)

const SITE_PAGE_KEYS = {
    about: 'sitePages.about',
    team: 'sitePages.team',
    pricing: 'sitePages.pricing',
    customers: 'sitePages.customers',
    product: 'sitePages.product',
    catalog: 'catalog',
    legal: 'sitePages.legal',
    careers: 'sitePages.careers',
    contact: 'sitePages.contact',
    privacy: 'sitePages.privacy',
    blog: 'sitePages.blog',
} as const

const SOURCE_KEYS = {
    dns: 'dns',
    stack: 'stack',
    search: 'search',
    catalog: 'catalog',
    registry: 'registry',
    linkedin: 'linkedin',
    'linkedin:company': 'linkedinCompany',
    'linkedin:person': 'linkedinPerson',
    google: 'google',
    'google:business': 'googleBusiness',
} as const

type BrainSourceKey = `sources.${'website' | (typeof SITE_PAGE_KEYS)[keyof typeof SITE_PAGE_KEYS] | (typeof SOURCE_KEYS)[keyof typeof SOURCE_KEYS]}`

// The `brain` namespace, as far as these labels read it.
export type BrainLabelCopy = (key: BrainSourceKey | 'authors.seed' | 'authors.foreman') => string

// The engine stores who wrote a page as `seed`, `user:<email>` or `agent:<name>`. The foreman
// writes as `agent:foreman`, a name the user never sees.
export function brainAuthorLabel(author: string, t: BrainLabelCopy): string {
    if (author === 'seed') return t('authors.seed')
    if (author === `agent:${FOREMAN_AGENT_ID}`) return t('authors.foreman')
    if (author.startsWith('agent:')) return author.slice('agent:'.length)
    if (author.startsWith('user:')) return author.slice('user:'.length)
    return author
}

const URL_LABEL_MAX = 40

// A product page's own address would stretch the badge across the page.
function urlLabel(tag: string): string | null {
    if (!/^https?:\/\//i.test(tag.trim())) return null
    try {
        const url = new URL(tag.trim())
        const label = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`
        return label.length > URL_LABEL_MAX ? `${label.slice(0, URL_LABEL_MAX - 1)}…` : label
    } catch {
        return null
    }
}

const hasKey = <T extends object>(map: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(map, key)

type BrainSource = { key: BrainSourceKey } | { text: string }

// The website research tags its facts `site:<what>`, `linkedin:company`… A link is shown by its
// host and path; anything else, such as a source an agent cited, is shown as written.
function brainSourceOf(tag: string): BrainSource {
    const normalized = tag.trim().toLowerCase()
    if (normalized === 'site' || normalized.startsWith('site:')) {
        const page = normalized.slice('site:'.length)
        return { key: hasKey(SITE_PAGE_KEYS, page) ? `sources.${SITE_PAGE_KEYS[page]}` : 'sources.website' }
    }
    if (hasKey(SOURCE_KEYS, normalized)) return { key: `sources.${SOURCE_KEYS[normalized]}` }
    return { text: urlLabel(tag) ?? tag }
}

const sourceLabel = (source: BrainSource, t: BrainLabelCopy) => ('key' in source ? t(source.key) : source.text)

export function brainSourceLabel(tag: string, t: BrainLabelCopy): string {
    return sourceLabel(brainSourceOf(tag), t)
}

export function brainSourceLabels(tags: readonly string[], t: BrainLabelCopy): string[] {
    const sources = new Map<string, BrainSource>()
    for (const tag of tags) {
        const source = brainSourceOf(tag)
        const identity = 'key' in source ? source.key : `text:${source.text}`
        if (!sources.has(identity)) sources.set(identity, source)
    }
    return [...sources.values()].map(source => sourceLabel(source, t))
}

export function brainSlugify(input: string): string {
    return input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '')
}
