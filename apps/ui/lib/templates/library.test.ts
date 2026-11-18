import { describe, expect, it } from 'vitest'
import type { PurchaseAccess } from './entitlement'
import { EMPTY_LIBRARY_FILTERS, type LibraryFilters, type LibraryRow, type LibraryTemplate, filterTemplates, isInMyLibrary, toLibraryTemplates } from './library'

function row(overrides: Partial<LibraryRow> = {}): LibraryRow {
    return {
        id: 't1',
        slug: 'kit',
        title: 'Kit',
        tagline: null,
        long_description: null,
        category: 'sales',
        tags: null,
        gallery: null,
        setup_minutes: 5,
        featured: false,
        status: 'published',
        agent_count: null,
        agents: [{ key: 'scout', name: 'Scout' }],
        connectors: [{ slug: 'hubspot', name: 'HubSpot', icon: null }],
        agent_archives: [{ agentKey: 'scout', path: 'private/path.tar.gz', bytes: 1, capturedAt: 't' }],
        creator_id: 'author',
        pricing_model: 'one_time',
        price_amount_cents: 1500,
        price_currency: 'usd',
        published_at: null,
        card_image_dark_url: null,
        card_image_light_url: null,
        ...overrides,
    }
}

describe('toLibraryTemplates', () => {
    it('fills the nullable text and lists and exposes archive names, never their paths', () => {
        const [template] = toLibraryTemplates([row()])
        expect(template).toMatchObject({ tagline: '', longDescription: '', tags: [], gallery: [], agentCount: 0, archiveAgentNames: ['Scout'] })
        expect(JSON.stringify(template)).not.toContain('private/path')
        expect(template).not.toHaveProperty('creator_id')
    })

    it('owns a free template, an authored one and an active purchase, not a lapsed one', () => {
        const rows = [row({ id: 'free', pricing_model: 'free', price_amount_cents: 0 }), row({ id: 'mine' }), row({ id: 'bought', creator_id: 'x' }), row({ id: 'lapsed', creator_id: 'x' }), row({ id: 'none', creator_id: 'x' })]
        const access = new Map<string, PurchaseAccess>([
            ['bought', 'active'],
            ['lapsed', 'lapsed'],
        ])
        const owned = Object.fromEntries(toLibraryTemplates(rows, 'author', access).map(t => [t.id, t.owned]))
        expect(owned).toEqual({ free: true, mine: true, bought: true, lapsed: false, none: false })
    })

    it('never counts an anonymous viewer as the author of a template without one', () => {
        const [template] = toLibraryTemplates([row({ creator_id: null })], null)
        expect(template.isMine).toBe(false)
        expect(template.access).toBe('none')
    })

    it('credits the published fiche of the author, and the Moldwright team otherwise', () => {
        const fiche = { slug: 'ada', name: 'Ada', kind: 'freelancer' as const, avatarUrl: null, bannerUrl: null, location: null, bio: null, links: { x: null, linkedin: null, github: null, website: null }, verified: true }
        const [signed, unsigned] = toLibraryTemplates([row({ id: 'a' }), row({ id: 'b', creator_id: 'stranger' })], null, undefined, new Map([['author', fiche]]))
        expect(signed.creator).toEqual(fiche)
        expect(unsigned.creator).toBeNull()
        expect(signed).not.toHaveProperty('creator_id')
    })

    it('puts featured templates first and keeps the read order otherwise', () => {
        const rows = [row({ id: 'a' }), row({ id: 'b', featured: true }), row({ id: 'c' }), row({ id: 'd', featured: true })]
        expect(toLibraryTemplates(rows).map(t => t.id)).toEqual(['b', 'd', 'a', 'c'])
    })
})

function template(overrides: Partial<LibraryTemplate> = {}): LibraryTemplate {
    return { ...toLibraryTemplates([row({ creator_id: null })])[0], ...overrides }
}

const filters = (overrides: Partial<LibraryFilters>): LibraryFilters => ({ ...EMPTY_LIBRARY_FILTERS, ...overrides })

describe('filterTemplates', () => {
    it('shows only published templates plus the viewer\'s own when no status is asked for', () => {
        const list = [template({ id: 'pub' }), template({ id: 'draft', status: 'draft' }), template({ id: 'my-draft', status: 'draft', isMine: true }), template({ id: 'unlisted', status: 'unlisted' })]
        expect(filterTemplates(list, EMPTY_LIBRARY_FILTERS).map(t => t.id)).toEqual(['pub', 'my-draft'])
    })

    it('lets an admin ask for exactly the statuses they want', () => {
        const list = [template({ id: 'pub' }), template({ id: 'review', status: 'in_review' }), template({ id: 'draft', status: 'draft', isMine: true })]
        expect(filterTemplates(list, filters({ statuses: ['in_review'] })).map(t => t.id)).toEqual(['review'])
    })

    it('widens inside the app dimension and narrows it against the statuses', () => {
        const list = [
            template({ id: 'hubspot' }),
            template({ id: 'stripe', connectors: [{ slug: 'stripe', name: 'Stripe', icon: null }] }),
            template({ id: 'notion', connectors: [{ slug: 'notion', name: 'Notion', icon: null }] }),
            template({ id: 'draft-hubspot', status: 'draft' }),
        ]
        expect(filterTemplates(list, filters({ connectorSlugs: ['hubspot', 'stripe'] })).map(t => t.id)).toEqual(['hubspot', 'stripe'])
        expect(filterTemplates(list, filters({ connectorSlugs: ['hubspot'], statuses: ['draft'] })).map(t => t.id)).toEqual(['draft-hubspot'])
    })
})

describe('isInMyLibrary', () => {
    it('includes a refunded purchase, which still differs from never having bought', () => {
        expect(isInMyLibrary(template({ access: 'refunded' }))).toBe(true)
        expect(isInMyLibrary(template())).toBe(false)
    })
})
