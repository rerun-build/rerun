import type { BrainPage } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'

import type { CompanyFindingsRow } from '@/lib/company/explore/findings'
import { answersEvidence, brainEvidence, buildEvidence, evidenceForPrompt, findingsEvidence } from './evidence'

function page(slug: string, title: string, content: string): BrainPage {
    return { slug, title, type: 'market', hash: 'h', updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'seed', content, sources: [], unconfirmed: [], links: [], backlinks: [] }
}

describe('brainEvidence', () => {
    it('cuts a page into one fact per bullet and per paragraph, under its section', () => {
        const drafts = brainEvidence([page('market', 'Market', '## Competitors\n\n- Lomi\n- **Terres de Café**\n\n## Reputation\n\nRated 4.8 on Google.\nReviews praise the delivery.\n')])

        expect(drafts).toEqual([
            { source: 'brain:market', topic: 'Market / Competitors', text: 'Lomi' },
            { source: 'brain:market', topic: 'Market / Competitors', text: 'Terres de Café' },
            { source: 'brain:market', topic: 'Market / Reputation', text: 'Rated 4.8 on Google. Reviews praise the delivery.' },
        ])
    })

    it('reads a wikilink as its text and leaves the Related section out', () => {
        const drafts = brainEvidence([page('company', 'Company', '## Summary\n\nSells to [[home-baristas|home baristas]] and competes with [[lomi]].\n\n## Related\n\n- [[offering]]\n')])

        expect(drafts.map(draft => draft.text)).toEqual(['Sells to home baristas and competes with lomi.'])
    })

    it('leaves out what our own research could not find', () => {
        expect(brainEvidence([page('open-questions', 'Open questions', '## To confirm with the team\n\n- Pricing and plans\n')])).toEqual([])
    })
})

describe('findingsEvidence', () => {
    it('keeps the facts the brain does not carry and drops the ones it does', () => {
        const row: CompanyFindingsRow = {
            url: 'https://maisonlune.fr',
            status: 'done',
            pending: [],
            findings: [
                { kind: 'reviews', source: 'googleBusiness', rating: 4.8, count: 127 },
                {
                    kind: 'tools',
                    source: 'stack',
                    tools: [
                        { name: 'Shopify', iconUrl: null },
                        { name: 'Klaviyo', iconUrl: null },
                    ],
                },
                { kind: 'competitors', source: 'synthesis', items: ['Lomi'] },
                { kind: 'brand', source: 'site', colors: ['#000'], fonts: [] },
            ],
        }

        expect(findingsEvidence(row)).toEqual([
            { source: 'findings:reviews', topic: 'Google reviews', text: 'Rated 4.8 from 127 Google reviews' },
            { source: 'findings:tools', topic: 'Tools spotted', text: 'Uses Shopify, Klaviyo' },
        ])
        expect(findingsEvidence(null)).toEqual([])
    })
})

describe('answersEvidence', () => {
    const answers = {
        company_name: 'Maison Lune',
        company_description: 'Roasts specialty coffee',
        industry: 'ecommerce' as const,
        tools: ['shopify', 'gmail'],
        foreman: { useCases: ['answer order emails'], needs: [{ job: 'answer order emails', pain: 'replies take two days', today: 'done by the founder at night' }] },
    }

    it('carries what the person said in the interview', () => {
        const texts = answersEvidence(answers, { withProfile: false }).map(draft => draft.text)

        expect(texts).toContain('answer order emails')
        expect(texts).toContain('answer order emails: replies take two days (today: done by the founder at night)')
        expect(texts).not.toContain('Maison Lune: Roasts specialty coffee')
    })

    it('falls back on the quick profile when there is no brain', () => {
        expect(answersEvidence(answers, { withProfile: true }).map(draft => draft.text)).toContain('Maison Lune: Roasts specialty coffee')
    })
})

describe('buildEvidence', () => {
    it('numbers the facts densely and keeps the first of two that say the same thing', () => {
        const evidence = buildEvidence(
            [
                { source: 'brain:market', topic: 'Market', text: 'Uses Shopify' },
                { source: 'brain:market', topic: 'Market', text: '' },
            ],
            [
                { source: 'findings:tools', topic: 'Tools spotted', text: 'uses shopify' },
                { source: 'findings:mail', topic: 'Email', text: 'Runs its email on Google Workspace' },
            ]
        )

        expect(evidence.map(item => [item.id, item.source])).toEqual([
            ['E1', 'brain:market'],
            ['E2', 'findings:mail'],
        ])
        expect(evidenceForPrompt(evidence)).toBe('[E1] (brain:market) Market: Uses Shopify\n[E2] (findings:mail) Email: Runs its email on Google Workspace')
    })
})
