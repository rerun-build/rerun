import { describe, expect, it } from 'vitest'
import { recommendTemplates, resolvePicks, scoreCandidate, shortlistTemplates, type RecommendContext, type TemplateCandidate } from './recommend'

const NOW = new Date('2026-09-03T12:00:00.000Z')
const APP_URL = 'https://moldwright.robagentic.tech'

function candidate(overrides: Partial<TemplateCandidate> & { slug: string }): TemplateCandidate {
    return {
        title: `Title ${overrides.slug}`,
        tagline: 'Drafts the weekly report and files it in Notion',
        category: 'productivity',
        featured: false,
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
        connectorSlugs: [],
        connectorNames: [],
        setupMinutes: 10,
        free: true,
        cardStamp: 'card.webp',
        ...overrides,
    }
}

function context(overrides: Partial<RecommendContext> = {}): RecommendContext {
    return { tools: [], industry: null, now: NOW, ...overrides }
}

describe('scoreCandidate', () => {
    it('weighs the first tool someone named above the last', () => {
        const stack = context({ tools: ['notion', 'slack', 'gmail', 'stripe', 'linear'] })
        const first = scoreCandidate(candidate({ slug: 'a', connectorSlugs: ['notion'], connectorNames: ['Notion'] }), stack)
        const last = scoreCandidate(candidate({ slug: 'b', connectorSlugs: ['linear'], connectorNames: ['Linear'] }), stack)
        expect(first).toBeGreaterThan(last)
    })

    it('penalises every service the account never mentioned', () => {
        const stack = context({ tools: ['notion'] })
        const lean = scoreCandidate(candidate({ slug: 'a', connectorSlugs: ['notion'] }), stack)
        const heavy = scoreCandidate(candidate({ slug: 'b', connectorSlugs: ['notion', 'stripe', 'hubspot'] }), stack)
        expect(lean).toBeGreaterThan(heavy)
    })
})

describe('shortlistTemplates', () => {
    it('keeps a featured template with nothing else going for it', () => {
        const shortlist = shortlistTemplates([candidate({ slug: 'featured', featured: true })], context())
        expect(shortlist.map(entry => entry.slug)).toEqual(['featured'])
    })

    it('drops a template that is only recent', () => {
        const shortlist = shortlistTemplates([candidate({ slug: 'recent', publishedAt: NOW })], context())
        expect(shortlist).toHaveLength(0)
    })

    it('never gives the model more than two of one category', () => {
        const many = ['a', 'b', 'c'].map(slug => candidate({ slug, featured: true, category: 'saas' }))
        expect(shortlistTemplates(many, context())).toHaveLength(2)
    })

    it('orders the same way on a retry when scores tie', () => {
        const tied = [candidate({ slug: 'zulu', featured: true }), candidate({ slug: 'alpha', featured: true })]
        expect(shortlistTemplates(tied, context()).map(entry => entry.slug)).toEqual(['alpha', 'zulu'])
        expect(shortlistTemplates([...tied].reverse(), context()).map(entry => entry.slug)).toEqual(['alpha', 'zulu'])
    })
})

describe('resolvePicks', () => {
    const shortlist = [candidate({ slug: 'alpha', connectorNames: ['Notion'] }), candidate({ slug: 'beta' })]

    it('drops a slug the model invented and a slug it repeated', () => {
        const picks = resolvePicks(
            shortlist,
            [
                { slug: 'alpha', line: 'Files the weekly recap in Notion' },
                { slug: 'ghost', line: 'A template that does not exist' },
                { slug: 'alpha', line: 'The same one again' },
            ],
            APP_URL,
        )

        expect(picks.map(pick => pick.slug)).toEqual(['alpha'])
        expect(picks[0].title).toBe('Title alpha')
    })

    it('falls back to the tagline when the model writes nothing', () => {
        const picks = resolvePicks(shortlist, [{ slug: 'beta', line: '   ' }], APP_URL)
        expect(picks[0].line).toBe('Drafts the weekly report and files it in Notion')
    })
})

describe('recommendTemplates', () => {
    it('sends nothing rather than a single recommendation', async () => {
        const result = await recommendTemplates([candidate({ slug: 'only', featured: true })], null, { appUrl: APP_URL, now: NOW, useModel: false })
        expect(result).toEqual({ ok: false, reason: 'too_few' })
    })

    it('falls back to the template taglines and the install deep link', async () => {
        const candidates = [candidate({ slug: 'alpha', featured: true, connectorNames: ['Notion'] }), candidate({ slug: 'beta', featured: true, category: 'sales' })]
        const result = await recommendTemplates(candidates, null, { appUrl: APP_URL, now: NOW, useModel: false })

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.picks).toHaveLength(2)
        expect(result.picks[0].line).toBe('Drafts the weekly report and files it in Notion')
        expect(result.picks[0].url).toBe(`${APP_URL}/?template=alpha`)
        expect(result.picks[0].imageUrl).toBe(`${APP_URL}/og/templates/alpha/email-card?v=2.card.webp`)
    })
})
