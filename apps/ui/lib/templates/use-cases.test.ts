import type { TemplateAgent } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { type LibraryTemplate, toLibraryTemplates } from './library'
import { coworkerUseCases, findUseCases, useCaseSummary } from './use-cases'

const gmail = { slug: 'gmail', name: 'Gmail', icon: null }
const slack = { slug: 'slack', name: 'Slack', icon: null }

const skills = (...names: string[]) => names.map(name => ({ name, description: '' }))

const agent = (key: string, overrides: Partial<TemplateAgent> = {}): TemplateAgent => ({ key, name: key, role: '', description: '', connectorSlugs: [], setupRequired: false, skills: [], schedules: [], triggers: [], tools: [], ...overrides })

function template(slug: string, agents: TemplateAgent[]): LibraryTemplate {
    const [base] = toLibraryTemplates([
        {
            id: slug,
            slug,
            title: slug,
            tagline: null,
            long_description: null,
            category: 'sales',
            tags: null,
            gallery: null,
            setup_minutes: 5,
            featured: false,
            status: 'published',
            agent_count: agents.length,
            agents,
            connectors: [gmail, slack],
            agent_archives: [],
            creator_id: null,
            pricing_model: 'free',
            price_amount_cents: 0,
            price_currency: 'usd',
            published_at: null,
            card_image_dark_url: null,
            card_image_light_url: null,
        },
    ])
    return base
}

const find = (templates: LibraryTemplate[], narrowed: { query?: string; connectorSlugs?: string[] } = {}) =>
    findUseCases(templates.flatMap(coworkerUseCases), { query: '', connectorSlugs: [], ...narrowed }).map(useCase => useCase.name)

describe('useCaseSummary', () => {
    it.each([
        ['Use when asked to chase an invoice. Reads the ledger first.', 'Chase an invoice.'],
        ['Use when asked to audit a codebase or one area of it, or to clean it up.', 'Audit a codebase or one area of it, or clean it up.'],
        ['Use when asked for a pick list, or to turn orders into lines.', 'A pick list, or to turn orders into lines.'],
        ['Use whenever asked about churn, and on the weekly review.', 'Churn.'],
        ['Use when asked about a CVE, and for new advisories on the weekly watch.', 'A CVE.'],
        ['Use when a customer disputes an invoice.', 'When a customer disputes an invoice.'],
        ['Use after a sales call, when given notes to file.', 'After a sales call, when given notes to file.'],
        ['Use for SEO reviews and public-page audits.', 'For SEO reviews and public-page audits.'],
        ['Use forms to collect leads.', 'Use forms to collect leads.'],
        ['Qualifies inbound leads', 'Qualifies inbound leads'],
        ['', ''],
    ])('reads %j as %j', (description, summary) => {
        expect(useCaseSummary(description)).toBe(summary)
    })
})

describe('coworkerUseCases', () => {
    it('gives each coworker of a team its own use cases, with the apps that coworker uses', () => {
        const team = template('team', [agent('scout', { connectorSlugs: ['gmail'], skills: skills('Find leads', 'Enrich leads') }), agent('writer', { skills: skills('Write the email') })])
        expect(coworkerUseCases(team).map(({ agent, useCases }) => [agent.key, useCases.map(u => u.id), useCases[0].connectors])).toEqual([
            ['scout', ['team:scout:0', 'team:scout:1'], [gmail]],
            ['writer', ['team:writer:0'], []],
        ])
    })

    it('reads a skill named after its folder as a title, and leaves a real title alone', () => {
        const [{ useCases }] = coworkerUseCases(template('t', [agent('seo', { skills: skills('seo-geo-squad', 'Track the rankings', 'SEO') })]))
        expect(useCases.map(u => u.name)).toEqual(['Seo geo squad', 'Track the rankings', 'SEO'])
    })
})

describe('findUseCases', () => {
    const billing = template('billing', [agent('billing', { name: 'Billing Specialist', connectorSlugs: ['gmail'], skills: skills('Send invoices', 'Add payment links', 'Produce e-invoices') })])
    const support = template('support', [agent('support', { name: 'Support Agent', connectorSlugs: ['slack'], skills: skills('Sort the inbox') })])
    const bare = template('bare', [agent('bare')])

    it('takes the coworkers in turn and leaves out those with no skill', () => {
        expect(find([billing, bare, support])).toEqual(['Send invoices', 'Sort the inbox', 'Add payment links', 'Produce e-invoices'])
        expect(find([bare])).toEqual([])
    })

    it('searches the task, the coworker and its apps', () => {
        expect(find([billing, support], { query: ' INVOICE ' })).toEqual(['Send invoices', 'Produce e-invoices'])
        expect(find([billing, support], { query: 'support agent' })).toEqual(['Sort the inbox'])
        expect(find([billing, support], { query: 'slack' })).toEqual(['Sort the inbox'])
    })

    it("narrows a team to the coworkers that use the app, not to the team's apps", () => {
        const team = template('team', [agent('scout', { connectorSlugs: ['gmail'], skills: skills('Find leads') }), agent('poster', { connectorSlugs: ['slack'], skills: skills('Post leads') })])
        expect(find([team], { connectorSlugs: ['slack'] })).toEqual(['Post leads'])
    })
})
