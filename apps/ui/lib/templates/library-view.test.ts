import { describe, expect, it } from 'vitest'
import { type LibraryCreator, type LibraryRow, type LibraryTemplate, toLibraryTemplates } from './library'
import { appCounts, categoryCounts, creatorOfTheWeek, creatorSummaries, creatorsToMeet, matchesQuery, stackApps, rankForViewer, templateHeadline, templatesInView } from './library-view'

const BASE_ROW: LibraryRow = {
    id: 't',
    slug: 't',
    title: 'Template',
    tagline: null,
    long_description: null,
    category: 'sales',
    tags: null,
    gallery: null,
    setup_minutes: 5,
    featured: false,
    status: 'published',
    agent_count: null,
    agents: [],
    connectors: [],
    agent_archives: [],
    creator_id: null,
    pricing_model: 'free',
    price_amount_cents: 0,
    price_currency: 'usd',
    published_at: null,
    card_image_dark_url: null,
    card_image_light_url: null,
}

function template(overrides: Partial<LibraryTemplate> = {}): LibraryTemplate {
    return { ...toLibraryTemplates([BASE_ROW])[0], ...overrides }
}

const creator = (slug: string): LibraryCreator => ({ slug, name: slug.toUpperCase(), kind: 'freelancer', avatarUrl: null, bannerUrl: null, location: null, bio: null, links: { x: null, linkedin: null, github: null, website: null }, verified: true })

describe('creatorSummaries', () => {
    it('groups by creator, most templates first, and leaves the Moldwright team out', () => {
        const templates = [template({ slug: 'a', creator: creator('ada') }), template({ slug: 'b', creator: creator('bob') }), template({ slug: 'c', creator: creator('bob') }), template({ slug: 'd' })]
        expect(creatorSummaries(templates).map(c => [c.slug, c.templates.length])).toEqual([
            ['bob', 2],
            ['ada', 1],
        ])
    })

    it('follows the authors with the rest of the directory, never twice', () => {
        const templates = [template({ slug: 'a', creator: creator('ada') })]
        expect(creatorSummaries(templates, [creator('zoe'), creator('ada')]).map(c => [c.slug, c.templates.length])).toEqual([
            ['ada', 1],
            ['zoe', 0],
        ])
    })
})

describe('creatorOfTheWeek', () => {
    const WEEK = 7 * 24 * 60 * 60 * 1000
    const creators = creatorSummaries([template({ slug: 'a', creator: creator('ada') }), template({ slug: 'b', creator: creator('bob') }), template({ slug: 'c', creator: creator('bob'), featured: true })])

    it('holds for a week, then hands over to the next creator', () => {
        const first = creatorOfTheWeek(creators, new Date(0))
        expect(creatorOfTheWeek(creators, new Date(WEEK - 1))?.creator.slug).toBe(first?.creator.slug)
        expect(creatorOfTheWeek(creators, new Date(WEEK))?.creator.slug).not.toBe(first?.creator.slug)
    })

    it("recognises the creator's featured template first", () => {
        expect(creatorOfTheWeek(creators, new Date(WEEK))?.template.slug).toBe('c')
    })

    it('has nobody to spotlight without a template author', () => {
        expect(creatorOfTheWeek([], new Date())).toBeNull()
        expect(creatorOfTheWeek(creatorSummaries([], [creator('zoe')]), new Date())).toBeNull()
    })
})

describe('rankForViewer', () => {
    it("ranks the viewer's industry and apps above the editorial order", () => {
        const hubspot = { slug: 'hubspot', name: 'HubSpot', icon: null }
        const templates = [template({ slug: 'featured', featured: true }), template({ slug: 'app', connectors: [hubspot] }), template({ slug: 'industry', category: 'legal' })]
        expect(rankForViewer(templates, { category: 'legal', connectorSlugs: ['hubspot'] }).map(t => t.slug)).toEqual(['industry', 'app', 'featured'])
    })
})

describe('templatesInView', () => {
    it("narrows to one creator's work", () => {
        const templates = [template({ slug: 'a', creator: creator('ada') }), template({ slug: 'b' })]
        expect(templatesInView(templates, { kind: 'creator', slug: 'ada' }).map(t => t.slug)).toEqual(['a'])
    })
})

describe('matchesQuery', () => {
    it('finds a template by the name of who made it', () => {
        expect(matchesQuery(template({ creator: creator('ada') }), 'ADA')).toBe(true)
        expect(matchesQuery(template(), 'ada')).toBe(false)
    })
})

describe('categoryCounts', () => {
    it('drops empty categories and files Other last whatever its size', () => {
        const templates = [template({ category: 'other' }), template({ category: 'other' }), template({ category: 'sales' })]
        expect(categoryCounts(templates)).toEqual([
            { category: 'sales', count: 1 },
            { category: 'other', count: 2 },
        ])
    })
})

describe('templateHeadline', () => {
    const agent = (name: string) => ({ key: name.toLowerCase(), name, role: '', description: '', connectorSlugs: [], setupRequired: false, skills: [], schedules: [], triggers: [], tools: [] })

    it("leads with the agent's name when the template is one agent", () => {
        expect(templateHeadline(template({ title: 'Qualify inbound leads', agents: [agent('Lead Qualifier')] }))).toEqual({ headline: 'Lead Qualifier', subline: 'Qualify inbound leads' })
    })

    it('leads with the title and lists the agents when there are several', () => {
        expect(templateHeadline(template({ title: 'Sales team', agents: [agent('Scout'), agent('Writer')] }))).toEqual({ headline: 'Sales team', subline: 'Scout, Writer' })
    })

    it('falls back on the tagline when no agent is captured yet', () => {
        expect(templateHeadline(template({ title: 'Soon', tagline: 'Coming up', agents: [] }))).toEqual({ headline: 'Soon', subline: 'Coming up' })
    })
})

describe('appCounts and stackApps', () => {
    const gmail = { slug: 'gmail', name: 'Gmail', icon: null }
    const slack = { slug: 'slack', name: 'Slack', icon: null }
    const templates = [template({ slug: 'a', connectors: [gmail, slack] }), template({ slug: 'b', connectors: [gmail] })]

    it('counts the templates each app appears in, most used first', () => {
        expect(appCounts(templates).map(app => [app.connector.slug, app.count])).toEqual([
            ['gmail', 2],
            ['slack', 1],
        ])
    })

    it("shows the viewer's own apps when the catalogue has something for them", () => {
        expect(stackApps(templates, ['slack', 'notion'])).toEqual({ mine: true, apps: [{ connector: slack, count: 1 }] })
    })

    it('falls back on the most used apps otherwise', () => {
        expect(stackApps(templates, ['notion']).mine).toBe(false)
        expect(stackApps(templates).apps.map(app => app.connector.slug)).toEqual(['gmail', 'slack'])
    })
})

describe('creatorsToMeet', () => {
    const creators = creatorSummaries(
        [template({ slug: 'a', creator: creator('ada') }), template({ slug: 'b', creator: creator('bob') }), template({ slug: 'c', creator: creator('bob') }), template({ slug: 'd', creator: creator('cy') })],
        ['dan', 'eve', 'fay', 'gus'].map(creator),
    )

    it('leads with the most published, leaves the spotlight out, and fills the row with a draw', () => {
        const row = creatorsToMeet(creators, { exclude: 'cy', seed: 1, count: 4 })
        expect(row.slice(0, 2).map(c => c.slug)).toEqual(['bob', 'ada'])
        expect(row).toHaveLength(4)
        expect(row.map(c => c.slug)).not.toContain('cy')
    })

    it('draws the same row for the same seed and another for another', () => {
        const draw = (seed: number) => creatorsToMeet(creators, { seed, count: 5 }).map(c => c.slug).join()
        expect(draw(7)).toBe(draw(7))
        expect(new Set([1, 2, 3, 4, 5].map(draw)).size).toBeGreaterThan(1)
    })
})
