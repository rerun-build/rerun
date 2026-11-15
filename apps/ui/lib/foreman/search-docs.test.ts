import { describe, expect, it } from 'vitest'

import { parseDocsSections, rankDocsSections } from './search-docs'

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
