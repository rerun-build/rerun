import type { BrainPageType, BrainSeedPage } from '@rerun/contracts'

import type { CatalogFindings, CatalogProduct } from '@/lib/company/explore/catalog-collector'
import type { BusinessCard } from '@/lib/company/explore/synthesize'
import { describeNeed } from '@/lib/foreman/needs'
import { foremanUseCases, type ForemanProfile } from '@/lib/foreman/phase'
import { slugify } from '@/lib/slugify'

export type SeedPagesInput = {
    card: BusinessCard
    brief: string
    foreman?: ForemanProfile | null
    catalog?: CatalogFindings | null
}

const SLUG_MAX = 64
const TITLE_MAX = 120
const SOURCES_MAX = 50
// What the engine's /brain/seed accepts in one call.
const SEED_PAGES_MAX = 100

const CARD_SLUGS = ['company', 'offering', 'market', 'team', 'voice', 'stack', 'priorities', 'open-questions'] as const
type CardSlug = (typeof CARD_SLUGS)[number]

// The model is told to leave a field empty, and still writes these now and then.
const PLACEHOLDER = /^(unknown|n\/a|na|none|not specified|not available|not found|-)$/i

// Only the collectors' tags count as sources, so a markdown link or a [[wikilink]] is never read as one.
const SOURCE_TAG = /\[((?:dns|stack|site|search|registry|linkedin|google|catalog)(?::[\w.-]+)?(?:\s*[,;]\s*(?:dns|stack|site|search|registry|linkedin|google|catalog)(?::[\w.-]+)?)*)\](?!\()/g

type BriefSection = 'overview' | 'offering' | 'market' | 'team' | 'presence' | 'tools' | 'questions'

const BRIEF_SECTION_MATCHERS: [BriefSection, RegExp][] = [
    ['overview', /^overview/],
    ['offering', /^offering/],
    ['market', /^customers?\b/],
    ['team', /^team/],
    ['presence', /^(presence|reputation)/],
    ['tools', /^(tools|stack)/],
    ['questions', /^open questions/],
]

function clean(value: string | null | undefined): string {
    const trimmed = (value ?? '').trim()
    return PLACEHOLDER.test(trimmed) ? '' : trimmed
}

function cleanList(values: readonly string[] | null | undefined): string[] {
    return [...new Set((values ?? []).map(clean).filter(Boolean))]
}

function withoutEmDashes(text: string): string {
    return text.replace(/\s*\u2014\s*/g, ', ').replace(/ \u2013 /g, ', ')
}

function fields(pairs: [label: string, value: string | null | undefined][]): string {
    return pairs
        .map(([label, value]) => [label, clean(value)] as const)
        .filter(([, value]) => value)
        .map(([label, value]) => `- **${label}:** ${value}`)
        .join('\n')
}

function bullets(values: readonly string[]): string {
    return values.map(value => `- ${value}`).join('\n')
}

function section(heading: string, body: string, level = 2): string {
    const trimmed = body.trim()
    return trimmed ? `${'#'.repeat(level)} ${heading}\n\n${trimmed}` : ''
}

function joinSections(sections: string[]): string {
    return sections.filter(Boolean).join('\n\n')
}

export function sourceTags(text: string): string[] {
    const tags = new Set<string>()
    for (const match of text.matchAll(SOURCE_TAG)) {
        for (const tag of match[1].split(/[,;]/)) tags.add(tag.trim())
    }
    return [...tags]
}

// Splits the brief on the level its known sections are written at, so a sub-heading inside one
// stays with it.
export function briefSections(brief: string): Partial<Record<BriefSection, string>> {
    const lines = brief.split('\n')
    const headings = lines.flatMap((line, index) => {
        const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
        if (!match) return []
        const title = match[2].replace(/[*_`]/g, '').trim().toLowerCase()
        const id = BRIEF_SECTION_MATCHERS.find(([, pattern]) => pattern.test(title))?.[0] ?? null
        return [{ index, level: match[1].length, id }]
    })
    const known = headings.filter(heading => heading.id)
    if (!known.length) return {}
    const level = Math.min(...known.map(heading => heading.level))
    const boundaries = headings.filter(heading => heading.level <= level)

    const sections: Partial<Record<BriefSection, string>> = {}
    boundaries.forEach((heading, position) => {
        if (!heading.id) return
        const end = boundaries[position + 1]?.index ?? lines.length
        const body = lines.slice(heading.index + 1, end).join('\n').trim()
        if (body) sections[heading.id] = sections[heading.id] ? `${sections[heading.id]}\n\n${body}` : body
    })
    return sections
}

// The sentences of the brief that name an entity, with their source tags, for the page of that
// entity. A short name ("AI") would match everywhere, hence the word boundaries.
function briefMentions(brief: string, name: string): string[] {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu')
    const sentences = brief
        .split('\n')
        .filter(line => !/^#{1,6}\s/.test(line))
        .flatMap(line => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').split(/(?<=[.!?\]])\s+(?=[A-Z\p{Lu}])/u))
        .map(sentence => sentence.trim())
        .filter(sentence => sentence && pattern.test(sentence))
    return [...new Set(sentences)]
}

type DraftPage = { slug: string; title: string; type: BrainPageType; sections: string[]; sources: string[] }

function finalize(page: DraftPage): BrainSeedPage | null {
    const content = withoutEmDashes(joinSections(page.sections))
    if (!content) return null
    return {
        slug: page.slug,
        title: withoutEmDashes(page.title).slice(0, TITLE_MAX),
        type: page.type,
        content,
        sources: [...new Set(page.sources)].slice(0, SOURCES_MAX),
    }
}

function researchNotes(text: string | undefined, heading = 'Research notes'): { section: string; sources: string[] } {
    if (!text) return { section: '', sources: [] }
    return { section: section(heading, text), sources: sourceTags(text) }
}

// Every name the card gave, linked when it got a page of its own.
function entityList(names: readonly string[], kept: Entity[]): string {
    const slugs = new Map(kept.map(entity => [entity.name, entity.slug]))
    return bullets(cleanList(names).map(name => (slugs.has(name) ? `[[${slugs.get(name)}|${name}]]` : name)))
}

type Entity = { slug: string; name: string }

// One page per name, in the order the card lists them. A name that slugs to an identity card page
// or to an entity already kept is dropped: it would overwrite or shadow that page.
function entities(names: readonly string[], taken: Set<string>): Entity[] {
    const kept: Entity[] = []
    for (const name of cleanList(names)) {
        const slug = slugify(name, { maxLength: SLUG_MAX })
        if (!slug || taken.has(slug)) continue
        taken.add(slug)
        kept.push({ slug, name })
    }
    return kept
}

function entityPage(entity: Entity, type: 'product' | 'competitor', brief: string, companyName: string): DraftPage {
    const mentions = briefMentions(brief, entity.name)
    const relation =
        type === 'product'
            ? `${entity.name} is one of the products or services of ${companyName || 'the company'}. See [[offering]].`
            : `${entity.name} competes with ${companyName || 'the company'}. See [[market]].`
    return {
        slug: entity.slug,
        title: entity.name,
        type,
        sections: [section('Overview', relation), section('Mentions in the research brief', bullets(mentions))],
        sources: mentions.flatMap(sourceTags),
    }
}

type CatalogEntity = Entity & { product: CatalogProduct }

function catalogEntities(catalog: CatalogFindings | null | undefined, taken: Set<string>): CatalogEntity[] {
    const products = new Map((catalog?.products ?? []).map(product => [product.name, product]))
    return entities([...products.keys()], taken).flatMap(entity => {
        const product = products.get(entity.name)
        return product ? [{ ...entity, product }] : []
    })
}

function catalogSection(catalog: CatalogFindings, kept: CatalogEntity[]): string {
    const count = catalog.total === null ? null : `${catalog.total}${catalog.totalIsLowerBound ? '+' : ''}`
    const summary = [
        `The online shop${catalog.platform ? ` (${catalog.platform})` : ''} at ${catalog.shopUrl}${count ? ` lists ${count} products` : ''}.`,
        kept.length ? 'The ones it puts forward have a page each, imported from the website.' : '',
        'Every other product is on the website: read its page there before writing about it.',
    ]
        .filter(Boolean)
        .join(' ')
    return joinSections([summary, section('Collections', bullets(cleanList(catalog.collections)), 3), section('Featured products', bullets(kept.map(entity => `[[${entity.slug}|${entity.name}]]`)), 3)])
}

function catalogProductPage(entity: CatalogEntity, companyName: string): DraftPage {
    const { product } = entity
    return {
        slug: entity.slug,
        title: entity.name,
        type: 'product',
        sections: [
            section('Overview', `${entity.name} is one of the products of ${companyName || 'the company'}, imported from its website. See [[offering]].`),
            section(
                'On the website',
                fields([
                    ['Page', product.url],
                    ['Image', product.image],
                    ['Category', product.category],
                    ['Tags', cleanList(product.tags).join(', ')],
                ])
            ),
            section('Description', product.description),
        ],
        sources: ['site:catalog', product.url],
    }
}

function priorityLines(foreman: ForemanProfile | null | undefined): { useCases: string[]; needs: string[] } {
    if (!foreman) return { useCases: [], needs: [] }
    const needs = (foreman.needs ?? []).filter(need => clean(need.job) && clean(need.pain)).map(describeNeed)
    const legacyPains = cleanList(foreman.pains)
    return { useCases: cleanList(foremanUseCases(foreman)), needs: needs.length ? needs : legacyPains }
}

// What the seed is about to write, short enough for a card: the identity pages by name, the entity
// pages by count.
export function seedPagesOutline(pages: BrainSeedPage[]): { topics: string[]; products: number; competitors: number } {
    return {
        topics: pages.filter(page => page.type !== 'product' && page.type !== 'competitor').map(page => page.title),
        products: pages.filter(page => page.type === 'product').length,
        competitors: pages.filter(page => page.type === 'competitor').length,
    }
}

// The identity card the company brain starts from: one page per facet of the business card, the
// matching part of the sourced brief appended where it says more, and one page per product and
// competitor so agents can link to them.
export function buildSeedPages({ card, brief, foreman, catalog }: SeedPagesInput): BrainSeedPage[] {
    const sections = briefSections(brief)
    const companyName = clean(card.company.name)
    const taken = new Set<string>(CARD_SLUGS)
    const catalogProducts = catalogEntities(catalog, taken)
    // With the shop's own product sheets at hand, a stub page per name the synthesis gave would only
    // compete with them.
    const products = catalogProducts.length ? [] : entities(card.offering.products, taken)
    const competitors = entities(card.market.competitors, taken)

    const drafts: Partial<Record<CardSlug, DraftPage>> = {}

    const offeringNotes = researchNotes(sections.offering)
    drafts.offering = {
        slug: 'offering',
        title: 'Offering',
        type: 'offering',
        sections: [
            section('Products and services', entityList(card.offering.products, [...catalogProducts, ...products])),
            section('Pricing', clean(card.offering.pricing)),
            section('Business model', clean(card.offering.businessModel)),
            catalog ? section('Catalog', catalogSection(catalog, catalogProducts)) : '',
            offeringNotes.section,
        ],
        sources: [...(catalog ? ['site:catalog'] : []), ...offeringNotes.sources],
    }

    const marketNotes = researchNotes(sections.market)
    const presenceNotes = researchNotes(sections.presence, 'Presence and reputation notes')
    const channels = card.presence.channels
        .map(channel => {
            const network = clean(channel.network)
            const url = clean(channel.url)
            const audience = clean(channel.audience)
            if (!network && !url) return ''
            return [network || url, network && url ? url : '', audience ? `(${audience})` : ''].filter(Boolean).join(' ')
        })
        .filter(Boolean)
    drafts.market = {
        slug: 'market',
        title: 'Market',
        type: 'market',
        sections: [
            section('Audience', clean(card.market.audience)),
            section('Ideal customer', clean(card.market.idealCustomer)),
            section('Notable customers', bullets(cleanList(card.market.notableCustomers))),
            section('Competitors', entityList(card.market.competitors, competitors)),
            section('Presence', bullets(channels)),
            section('Reputation', clean(card.presence.reputation)),
            marketNotes.section,
            presenceNotes.section,
        ],
        sources: [...marketNotes.sources, ...presenceNotes.sources],
    }

    const teamNotes = researchNotes(sections.team)
    const person = card.person
    drafts.team = {
        slug: 'team',
        title: 'Team',
        type: 'team',
        sections: [
            section(
                'Account owner',
                [
                    fields([
                        ['Name', person.name],
                        ['Role', person.role],
                        ['Headline', person.headline],
                        ['Location', person.location],
                        ['LinkedIn', person.linkedinUrl],
                    ]),
                    clean(person.background),
                ]
                    .filter(Boolean)
                    .join('\n\n')
            ),
            teamNotes.section,
        ],
        sources: teamNotes.sources,
    }

    const branding = card.branding
    drafts.voice = {
        slug: 'voice',
        title: 'Voice',
        type: 'voice',
        sections: [
            section('Tone', clean(card.voice.tone)),
            section('Language', clean(card.voice.language)),
            section(
                'Brand',
                fields([
                    ['Logo', branding.logo],
                    ['Colors', cleanList(branding.colors).join(', ')],
                    ['Fonts', cleanList(branding.fonts).join(', ')],
                ])
            ),
        ],
        sources: [],
    }

    const toolsNotes = researchNotes(sections.tools)
    drafts.stack = {
        slug: 'stack',
        title: 'Stack',
        type: 'stack',
        sections: [section('Software in use', bullets(cleanList(card.stack))), toolsNotes.section],
        sources: toolsNotes.sources,
    }

    const unknowns = cleanList(card.unknowns)
    drafts['open-questions'] = {
        slug: 'open-questions',
        title: 'Open questions',
        type: 'note',
        sections: unknowns.length
            ? [section('To confirm with the team', `The research could not answer these. Confirm them and update the matching page.\n\n${bullets(unknowns)}`)]
            : [section('To confirm with the team', sections.questions ?? '')],
        sources: unknowns.length ? [] : sourceTags(sections.questions ?? ''),
    }

    const { useCases, needs } = priorityLines(foreman)
    drafts.priorities = {
        slug: 'priorities',
        title: 'Priorities',
        type: 'priorities',
        sections: [section('What to take off their hands', bullets(useCases)), section('Needs from the onboarding interview', bullets(needs))],
        sources: [],
    }

    const finished = new Map<CardSlug, BrainSeedPage>()
    for (const slug of CARD_SLUGS) {
        const draft = drafts[slug]
        const page = draft && finalize(draft)
        if (page) finished.set(slug, page)
    }

    const overviewNotes = researchNotes(sections.overview)
    const company = card.company
    const related = (['offering', 'market', 'team', 'voice', 'stack', 'priorities', 'open-questions'] as const).filter(slug => finished.has(slug)).map(slug => `[[${slug}]]`)
    const companyPage = finalize({
        slug: 'company',
        title: companyName || 'Company',
        type: 'company',
        sections: [
            section('Summary', clean(company.oneLiner)),
            section('Description', clean(company.description)),
            section(
                'Facts',
                fields([
                    ['Industry', company.industry],
                    ['Founded', company.founded],
                    ['Headcount', company.headcount],
                    ['Headquarters', company.headquarters],
                    ['Legal name', company.legalName],
                    ['SIREN', company.siren],
                ])
            ),
            overviewNotes.section,
            section('Related', bullets(related)),
        ],
        sources: overviewNotes.sources,
    })

    const entityPages = [
        ...catalogProducts.map(product => catalogProductPage(product, companyName)),
        ...products.map(product => entityPage(product, 'product', brief, companyName)),
        ...competitors.map(competitor => entityPage(competitor, 'competitor', brief, companyName)),
    ]
        .map(finalize)
        .filter((page): page is BrainSeedPage => page !== null)

    return [...(companyPage ? [companyPage] : []), ...finished.values(), ...entityPages].slice(0, SEED_PAGES_MAX)
}
