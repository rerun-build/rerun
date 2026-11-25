import { RERUN_BRAND } from '@rerun/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseDocsSections, rankDocsSections, searchDocs } from './search-docs'

// The shape docs.rerun.build serves at /llms-full.txt: every page behind a `# Title` / `Source:`
// pair, one after the other in a single file.
const CORPUS = `# Automations
Source: https://docs.rerun.build/agents/automations

Make an agent run without you.

## Scheduled tasks

A scheduled task runs an agent on a cron expression, in its own session.

## Webhook triggers

A trigger gives an agent a public URL. Calling it starts a run. The token in the URL is the only
thing protecting it, so rotate the token when it leaks.

# Billing
Source: https://docs.rerun.build/billing

What a workspace pays for.

## Credit

Every run spends credit. A trial workspace gets two dollars of credit.
`

describe('parseDocsSections', () => {
    const sections = parseDocsSections(CORPUS)

    it('keeps the intro of a page and each of its headings apart', () => {
        expect(sections.map(section => [section.page, section.heading])).toEqual([
            ['Automations', null],
            ['Automations', 'Scheduled tasks'],
            ['Automations', 'Webhook triggers'],
            ['Billing', null],
            ['Billing', 'Credit'],
        ])
    })

    it('links a heading to its own anchor, and an intro to the page', () => {
        expect(sections[0].url).toBe('https://docs.rerun.build/agents/automations')
        expect(sections[2].url).toBe('https://docs.rerun.build/agents/automations#webhook-triggers')
    })

    it('stops a page at the next one', () => {
        expect(sections[2].body).toContain('rotate the token')
        expect(sections[2].body).not.toContain('Billing')
    })
})

describe('rankDocsSections', () => {
    const sections = parseDocsSections(CORPUS)

    it('answers with the section the words are in', () => {
        expect(rankDocsSections(sections, 'webhook trigger token')[0].heading).toBe('Webhook triggers')
        expect(rankDocsSections(sections, 'how much credit does a trial get')[0].heading).toBe('Credit')
    })

    it('answers nothing rather than anything when no word matches', () => {
        expect(rankDocsSections(sections, 'kubernetes')).toEqual([])
    })

    it('never hands back more than two sections of the same page', () => {
        const hits = rankDocsSections(sections, 'agent run')
        expect(hits.filter(section => section.page === 'Automations')).toHaveLength(2)
    })
})

describe('searchDocs', () => {
    const NORDLYS = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example', links: { docs: 'https://help.nordlys.example', terms: null, privacy: null } }
    const PAGES = `${CORPUS}
# Vault
Source: https://docs.rerun.build/vault

Rerun keeps every account once. See [Billing](/billing) or ask the Rerun team.

## Paid apps

Two apps are sold by the account.
`

    const serve = (body: string) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body))

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('answers Rerun as it always has', async () => {
        serve(PAGES)
        expect(await searchDocs('vault account')).toEqual({
            documentation: 'https://docs.rerun.build',
            passages: expect.arrayContaining([{ title: 'Vault', url: 'https://docs.rerun.build/vault', text: 'Rerun keeps every account once. See [Billing](/billing) or ask the Rerun team.' }]),
        })
    })

    it('answers a brand in its name, without a link of Rerun', async () => {
        serve(PAGES)
        const answer = await searchDocs('Nordlys vault account', NORDLYS)
        expect(answer.documentation).toBe('https://help.nordlys.example')
        expect(answer.passages).toContainEqual({ title: 'Vault', text: 'Nordlys keeps every account once.' })
        expect(answer.note).toContain('help@nordlys.example')
        expect(JSON.stringify(answer)).not.toMatch(/rerun|discord/i)
    })

    it('holds no price, whatever is asked', async () => {
        serve(PAGES)
        for (const question of ['credit trial dollars', 'paid apps sold', 'Nordlys pricing']) {
            const answer = await searchDocs(question, NORDLYS)
            expect(JSON.stringify(answer.passages)).not.toMatch(/trial|dollars|sold|billing/i)
            expect(answer.note).toContain('never state one')
        }
    })

    it('names no address of Rerun when the documentation cannot be read, nor when the organization has none', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 60 * 60_000 })
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('docs.rerun.build is down'))
        const answer = await searchDocs('vault', { ...NORDLYS, links: { ...NORDLYS.links, docs: null } })
        expect(answer).toEqual({ passages: [], note: expect.any(String) })
        expect(JSON.stringify(answer)).not.toMatch(/rerun/i)
    })
})
