import { generateObject } from 'ai'
import { z } from 'zod'

import { openrouter } from '@/lib/ai/openrouter'
import { extractPhotoUrl } from '@/lib/experts/linkedin-scrape'
import { CollectorSkipped, type Collector, type CollectorData, type ExploreInput } from './types'

const SYNTHESIS_MODEL = process.env.RERUN_COMPANY_BRIEF_MODEL ?? 'anthropic/claude-sonnet-5.5'

const PAGE_CHARS = 5_000
const BLOCK_CHARS = 12_000
const CATALOG_DESCRIPTION_CHARS = 300

const businessCardSchema = z.object({
    company: z.object({
        name: z.string().describe('Commercial name, as the company presents itself'),
        legalName: z.string().describe('Registered legal name, empty if unknown'),
        oneLiner: z.string().describe('What the company does, in one plain sentence under 20 words'),
        description: z.string().describe('Two to four sentences: what it does, for whom, how it is different'),
        industry: z.string(),
        founded: z.string().describe('Year, empty if unknown'),
        headcount: z.string().describe('Best estimate with its source in parentheses, e.g. "50-99 (registry)"'),
        headquarters: z.string(),
        siren: z.string().describe('Empty if not French or unknown'),
    }),
    person: z.object({
        name: z.string().describe('The person who signed up, empty if unknown'),
        role: z.string().describe('Their role at this company'),
        headline: z.string(),
        location: z.string(),
        linkedinUrl: z.string(),
        background: z.string().describe('Two sentences on their path, empty if unknown'),
    }),
    offering: z.object({
        products: z.array(z.string()).describe('Main products or services, short names'),
        pricing: z.string().describe('Pricing model and price points if public'),
        businessModel: z.string().describe('e.g. B2B SaaS subscription, local service, e-commerce'),
    }),
    market: z.object({
        audience: z.string(),
        idealCustomer: z.string().describe('The ideal customer profile, as concrete as the sources allow'),
        notableCustomers: z.array(z.string()),
        competitors: z.array(z.string()),
    }),
    presence: z.object({
        channels: z.array(z.object({ network: z.string(), url: z.string(), audience: z.string().describe('Followers or reviews count if known') })),
        reputation: z.string().describe('Ratings and what reviews say, empty if nothing'),
    }),
    stack: z.array(z.string()).describe('Software the company uses, deduplicated, most useful for an AI assistant first'),
    voice: z.object({
        tone: z.string().describe('How the company writes, in a few adjectives'),
        language: z.string().describe('Main language of its content'),
    }),
    unknowns: z.array(z.string()).describe('Important things the sources did not answer, worth asking the person'),
})

const synthesisSchema = z.object({
    card: businessCardSchema,
    brief: z
        .string()
        .describe(
            'Markdown company brief, 400 to 900 words, sections: Overview, Offering, Customers & market, Team, Presence & reputation, Tools, Open questions. Every fact ends with its source tag in brackets, e.g. [site:pricing], [registry], [linkedin:company].'
        ),
})

export type BusinessCard = z.infer<typeof businessCardSchema> & {
    branding: { logo: string | null; colors: string[]; fonts: string[] }
    person: z.infer<typeof businessCardSchema>['person'] & { photoUrl: string | null }
}

export type SynthesisFindings = { model: string; card: BusinessCard; brief: string }

type Sources = { [K in Exclude<keyof CollectorData, 'synthesis'>]: CollectorData[K] | null }

function block(tag: string, value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return `<source tag="${tag}">\n${text.slice(0, BLOCK_CHARS)}\n</source>`
}

export function sourcesForPrompt(sources: Sources): string {
    const blocks: string[] = []
    const { dns, stack, site, search, registry, linkedinPerson, linkedinCompany, googleBusiness, catalog } = sources
    if (dns) blocks.push(block('dns', { mailProvider: dns.mailProvider, services: dns.services }))
    if (stack) blocks.push(block('stack', { technologies: stack.technologies, meta: stack.meta, social: stack.social }))
    if (site) {
        for (const page of site.pages) blocks.push(block(`site:${page.category}`, `${page.url}\n${page.markdown.slice(0, PAGE_CHARS)}`))
        blocks.push(block('site:links', { social: site.social, linkedinPeople: site.linkedinPeople }))
    }
    if (search) for (const query of search.queries) blocks.push(block(`search:${query.kind}`, query.results))
    if (registry) blocks.push(block('registry', { matchedBy: registry.matchedBy, personIsOfficer: registry.personIsOfficer, company: registry.company }))
    if (linkedinPerson) blocks.push(block('linkedin:person', { foundVia: linkedinPerson.source, url: linkedinPerson.url, profile: linkedinPerson.profile }))
    if (linkedinCompany) blocks.push(block('linkedin:company', { foundVia: linkedinCompany.source, matchesWebsite: linkedinCompany.matchesWebsite, company: linkedinCompany.company }))
    if (googleBusiness) blocks.push(block('google:business', { matchesWebsite: googleBusiness.matchesWebsite, place: googleBusiness.place }))
    if (catalog)
        blocks.push(
            block('catalog', {
                platform: catalog.platform,
                shopUrl: catalog.shopUrl,
                productCount: catalog.total === null ? null : `${catalog.total}${catalog.totalIsLowerBound ? '+' : ''}`,
                collections: catalog.collections,
                featuredProducts: catalog.products.map(product => ({ name: product.name, category: product.category, description: product.description.slice(0, CATALOG_DESCRIPTION_CHARS) })),
            })
        )
    return blocks.join('\n\n')
}

function prompt(input: ExploreInput, sources: string): string {
    return [
        'You are building the company profile an AI assistant will rely on to work for this company and for the person who signed up.',
        `The person typed: website ${input.url}${input.personName ? `, name ${input.personName}` : ''}${input.email ? `, email ${input.email}` : ''}.`,
        'Below is everything our explorers collected, one tagged block per source.',
        '',
        'Rules:',
        '- Only state what a source supports. Leave a field empty rather than guess, and list the gap in `unknowns`.',
        '- Sources can match a namesake: anything found via search, a registry entry matched by name where the person is not an officer, a LinkedIn page or Google place whose `matchesWebsite` is false. Check it against the website and the person; drop what does not fit, and say so in the brief.',
        '- Prefer the registry for legal facts, LinkedIn for headcount and people, the site for offering and pricing.',
        '- For an online shop, the catalog source lists its real products: name the main ones in offering.products and say it is e-commerce in businessModel.',
        '- Write the card and the brief in English, except proper names and quotes.',
        '',
        sources,
    ].join('\n')
}

export const synthesisCollector: Collector<'synthesis'> = {
    id: 'synthesis',
    needs: ['dns', 'stack', 'site', 'search', 'registry', 'linkedinPerson', 'linkedinCompany', 'googleBusiness', 'catalog'],
    async run({ input, need }) {
        const [dns, stack, site, search, registry, linkedinPerson, linkedinCompany, googleBusiness, catalog] = await Promise.all([
            need('dns'),
            need('stack'),
            need('site'),
            need('search'),
            need('registry'),
            need('linkedinPerson'),
            need('linkedinCompany'),
            need('googleBusiness'),
            need('catalog'),
        ])
        const sources = sourcesForPrompt({ dns, stack, site, search, registry, linkedinPerson, linkedinCompany, googleBusiness, catalog })
        if (!sources) throw new CollectorSkipped('Aucune source à synthétiser')

        const { object, usage } = await generateObject({
            model: openrouter(SYNTHESIS_MODEL),
            schema: synthesisSchema,
            prompt: prompt(input, sources),
            maxOutputTokens: 16_000,
        })

        const themeColor = stack?.meta.themeColor
        const card: BusinessCard = {
            ...object.card,
            person: { ...object.card.person, photoUrl: linkedinPerson ? extractPhotoUrl(linkedinPerson.profile) : null },
            branding: {
                logo: site?.branding?.logo ?? (linkedinCompany?.matchesWebsite ? linkedinCompany.company.logo : null) ?? stack?.meta.favicon ?? null,
                colors: [...new Set([...Object.values(site?.branding?.colors ?? {}), ...(themeColor ? [themeColor] : [])])],
                fonts: site?.branding?.fonts ?? [],
            },
        }

        return {
            data: { model: SYNTHESIS_MODEL, card, brief: object.brief },
            cost: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
            highlights: [`${card.company.name} : ${card.company.oneLiner}`, `${card.unknowns.length} question(s) ouvertes`, `Brief de ${object.brief.split(/\s+/).length} mots`],
        }
    },
}
