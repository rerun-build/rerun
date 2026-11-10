import { brainSeedPageSchema } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import type { CatalogFindings } from '@/lib/company/explore/catalog-collector'
import type { BusinessCard } from '@/lib/company/explore/synthesize'
import { briefSections, buildSeedPages, seedPagesOutline, sourceTags } from './seed-pages'

function card(overrides: Partial<BusinessCard> = {}): BusinessCard {
    return {
        company: { name: '', legalName: '', oneLiner: '', description: '', industry: '', founded: '', headcount: '', headquarters: '', siren: '' },
        person: { name: '', role: '', headline: '', location: '', linkedinUrl: '', background: '', photoUrl: null },
        offering: { products: [], pricing: '', businessModel: '' },
        market: { audience: '', idealCustomer: '', notableCustomers: [], competitors: [] },
        presence: { channels: [], reputation: '' },
        stack: [],
        voice: { tone: '', language: '' },
        unknowns: [],
        branding: { logo: null, colors: [], fonts: [] },
        ...overrides,
    }
}

const FULL_CARD = card({
    company: {
        name: 'Acme Café',
        legalName: 'ACME CAFE SAS',
        oneLiner: 'Specialty coffee roaster selling to offices in Lyon.',
        description: 'Acme roasts beans in Lyon and delivers them to offices on a subscription.',
        industry: 'Food & beverage',
        founded: '2019',
        headcount: '10-19 (registry)',
        headquarters: 'Lyon, France',
        siren: '123456789',
    },
    person: { name: 'Marie Dupont', role: 'Founder', headline: 'Coffee nerd', location: 'Lyon', linkedinUrl: 'https://linkedin.com/in/marie', background: 'Ten years at a roaster before founding Acme.', photoUrl: null },
    offering: { products: ['Office Subscription', 'Barista Training'], pricing: 'From 49 EUR per month', businessModel: 'B2B subscription' },
    market: { audience: 'Offices in Lyon', idealCustomer: 'Tech companies of 50 to 200 people', notableCustomers: ['Doctolib'], competitors: ['Nespresso Pro', 'Café Richard'] },
    presence: { channels: [{ network: 'Instagram', url: 'https://instagram.com/acme', audience: '4k followers' }], reputation: '4.8 on Google from 120 reviews' },
    stack: ['Shopify', 'HubSpot'],
    voice: { tone: 'Warm, expert', language: 'French' },
    unknowns: ['Annual revenue', 'Number of office clients'],
    branding: { logo: 'https://acme.fr/logo.png', colors: ['#3b2f2f'], fonts: ['Inter'] },
})

const BRIEF = `# Acme Café brief

## Overview
Acme roasts coffee in Lyon since 2019 [registry]. It has a roastery downtown [site:home].

## Offering
The office subscription starts at 49 EUR a month [site:pricing]. Barista Training is sold by the day [site:services].

## Customers & market
Doctolib is a customer [site:home]. Nespresso Pro is the main alternative cited in the press [search:alternatives].

## Team
Marie Dupont founded the company [linkedin:person].

## Presence & reputation
Rated 4.8 on Google [google:business].

## Tools
Shopify powers the shop [stack]. See [the docs](https://example.com).

## Open questions
- Revenue is not public.
`

describe('brief parsing', () => {
    it('splits the brief on its known sections', () => {
        const sections = briefSections(BRIEF)
        expect(sections.offering).toContain('49 EUR')
        expect(sections.market).toContain('Doctolib')
        expect(sections.tools).toContain('Shopify')
    })

    it('reads source tags but not links or wikilinks', () => {
        expect(sourceTags('a [site:pricing] b [registry, linkedin:company] [[offering]] [docs](https://x.y)')).toEqual(['site:pricing', 'registry', 'linkedin:company'])
    })
})

describe('buildSeedPages', () => {
    it('builds the whole identity card from a full card', () => {
        const pages = buildSeedPages({ card: FULL_CARD, brief: BRIEF, foreman: null })
        const bySlug = new Map(pages.map(page => [page.slug, page]))

        expect([...bySlug.keys()]).toEqual(['company', 'offering', 'market', 'team', 'voice', 'stack', 'open-questions', 'office-subscription', 'barista-training', 'nespresso-pro', 'cafe-richard'])
        for (const page of pages) expect(brainSeedPageSchema.safeParse(page).success).toBe(true)

        const company = bySlug.get('company')!
        expect(company.title).toBe('Acme Café')
        expect(company.content).toContain('- **SIREN:** 123456789')
        expect(company.content).toContain('[[offering]]')
        expect(company.content).not.toContain('[[priorities]]')
        expect(company.sources).toEqual(['registry', 'site:home'])

        const offering = bySlug.get('offering')!
        expect(offering.content).toContain('[[office-subscription|Office Subscription]]')
        expect(offering.sources).toEqual(['site:pricing', 'site:services'])

        const market = bySlug.get('market')!
        expect(market.content).toContain('[[cafe-richard|Café Richard]]')
        expect(market.sources).toEqual(['site:home', 'search:alternatives', 'google:business'])

        expect(bySlug.get('team')!.content).toContain('- **Name:** Marie Dupont')
        expect(bySlug.get('stack')!.sources).toEqual(['stack'])
        expect(bySlug.get('open-questions')!.type).toBe('note')
        expect(bySlug.get('open-questions')!.content).toContain('- Annual revenue')

        const competitor = bySlug.get('nespresso-pro')!
        expect(competitor.type).toBe('competitor')
        expect(competitor.content).toContain('main alternative cited in the press')
        expect(competitor.sources).toEqual(['search:alternatives'])
        expect(bySlug.get('barista-training')!.type).toBe('product')

        const everything = pages.map(page => page.content + page.title).join('\n')
        expect(everything).not.toContain('\u2014')
        expect(everything).not.toMatch(/unknown/i)
    })

    it('outlines the identity pages by name and the entity pages by count', () => {
        const pages = buildSeedPages({ card: FULL_CARD, brief: BRIEF, foreman: null })

        expect(seedPagesOutline(pages)).toEqual({ topics: ['Acme Café', 'Offering', 'Market', 'Team', 'Voice', 'Stack', 'Open questions'], products: 2, competitors: 2 })
    })

    it('keeps only the pages a sparse card can fill', () => {
        const sparse = card({ company: { ...card().company, name: 'Solo', industry: 'Unknown' }, voice: { tone: 'Direct \u2014 short', language: '' } })
        const pages = buildSeedPages({ card: sparse, brief: '', foreman: {} })

        expect(pages.map(page => page.slug)).toEqual(['company', 'voice'])
        const company = pages[0]
        expect(company.content).not.toContain('Industry')
        expect(company.content).toContain('[[voice]]')
        expect(company.content).not.toContain('[[offering]]')
        expect(pages[1].content).toContain('Direct, short')
    })

    it('drops entity names that collide with each other or with a card page', () => {
        const colliding = card({
            company: { ...card().company, name: 'Acme' },
            offering: { products: ['Widget', 'widget!', 'Stack', '  ', 'Wìdget'], pricing: '', businessModel: '' },
            market: { ...card().market, competitors: ['Widget', 'Rival'] },
        })
        const slugs = buildSeedPages({ card: colliding, brief: '', foreman: null }).map(page => page.slug)

        expect(slugs.filter(slug => slug === 'widget')).toHaveLength(1)
        expect(slugs).toContain('rival')
        expect(slugs.filter(slug => slug === 'stack')).toHaveLength(0)
        const offering = buildSeedPages({ card: colliding, brief: '', foreman: null }).find(page => page.slug === 'offering')!
        expect(offering.content).toContain('- Stack')
    })

    it('writes the priorities from the foreman interview', () => {
        const pages = buildSeedPages({
            card: card({ company: { ...card().company, name: 'Acme' } }),
            brief: '',
            foreman: { useCases: ['Answer support emails', 'Chase unpaid invoices'], needs: [{ job: 'Answer support emails', pain: 'Two hours a day', today: 'by hand in Gmail' }] },
        })
        const priorities = pages.find(page => page.slug === 'priorities')!

        expect(priorities.type).toBe('priorities')
        expect(priorities.content).toContain('- Chase unpaid invoices')
        expect(priorities.content).toContain('- Answer support emails: Two hours a day (today: by hand in Gmail)')
        expect(pages[0].content).toContain('[[priorities]]')
    })

    it('gives each featured product of the shop a page, in place of the stub pages', () => {
        const catalog: CatalogFindings = {
            platform: 'Shopify',
            shopUrl: 'https://acme.fr',
            total: 1000,
            totalIsLowerBound: true,
            collections: ['Bébé', 'Maison'],
            products: [
                {
                    name: 'Coussin anti-chute',
                    url: 'https://acme.fr/products/coussin',
                    image: 'https://cdn.shopify.com/coussin.jpg',
                    category: 'Bébé',
                    tags: ['securite'],
                    description: 'Protège la tête de bébé quand il apprend à marcher.',
                },
                { name: 'Offering', url: 'https://acme.fr/products/offering', image: null, category: null, tags: [], description: 'A name that collides with a card page.' },
            ],
        }
        const pages = buildSeedPages({ card: card({ ...FULL_CARD, offering: { ...FULL_CARD.offering, products: ['Coussin anti-chute', 'Office Subscription'] } }), brief: BRIEF, foreman: null, catalog })
        const offering = pages.find(page => page.slug === 'offering')!
        const coussin = pages.find(page => page.slug === 'coussin-anti-chute')!

        expect(offering.content).toContain('## Catalog\n\nThe online shop (Shopify) at https://acme.fr lists 1000+ products.')
        expect(offering.content).toContain('### Collections\n\n- Bébé\n- Maison')
        expect(offering.content).toContain('### Featured products\n\n- [[coussin-anti-chute|Coussin anti-chute]]')
        expect(offering.content).toContain('## Products and services\n\n- [[coussin-anti-chute|Coussin anti-chute]]\n- Office Subscription')
        expect(offering.content).toContain('read its page there before writing about it')
        expect(offering.sources).toContain('site:catalog')

        expect(coussin.type).toBe('product')
        expect(coussin.content).toContain('imported from its website. See [[offering]].')
        expect(coussin.content).toContain('- **Page:** https://acme.fr/products/coussin')
        expect(coussin.content).toContain('- **Image:** https://cdn.shopify.com/coussin.jpg')
        expect(coussin.content).toContain('## Description\n\nProtège la tête de bébé')
        expect(coussin.sources).toEqual(['site:catalog', 'https://acme.fr/products/coussin'])

        expect(pages.filter(page => page.type === 'product').map(page => page.slug)).toEqual(['coussin-anti-chute'])
        expect(pages.filter(page => page.slug === 'offering')).toHaveLength(1)
        for (const page of pages) expect(brainSeedPageSchema.safeParse(page).success).toBe(true)
    })

    it('never sends more pages than one seed call takes', () => {
        const competitors = Array.from({ length: 80 }, (_, index) => `Rival ${index}`)
        const products = Array.from({ length: 25 }, (_, index) => ({ name: `Produit ${index}`, url: `https://acme.fr/products/p-${index}`, image: null, category: null, tags: [], description: 'x' }))
        const pages = buildSeedPages({
            card: card({ ...FULL_CARD, market: { ...FULL_CARD.market, competitors } }),
            brief: '',
            foreman: null,
            catalog: { platform: null, shopUrl: 'https://acme.fr', total: 25, totalIsLowerBound: false, collections: [], products },
        })
        expect(pages).toHaveLength(100)
        expect(pages.filter(page => page.type === 'product')).toHaveLength(25)
    })
})
