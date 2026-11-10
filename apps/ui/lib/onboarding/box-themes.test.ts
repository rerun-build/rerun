import frBuilder from '@rerun/i18n/messages/fr/builder.json'
import { SUGGESTION_CARDS } from '@rerun/ui/new-agent'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'

import type { StoredIdea } from '@/lib/agent-ideas/stored'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { INDUSTRY_AGENT_SUGGESTIONS } from './agent-suggestions'
import { DEFAULT_BOX_NAMES } from './box-name-suggestions'
import { BOX_THEMES, boxCtaExamples, boxCtaLabel, boxIdeas, boxSuggestions, boxTheme, themeSuggestions } from './box-themes'

function idea(name: string, lens: StoredIdea['lens']): StoredIdea {
    return { id: `idea-${name.toLowerCase().replace(/ /g, '-')}`, name, hook: 'A fact.', lens, kickoff: 'Do the job.', apps: ['gmail'] }
}

describe('boxTheme', () => {
    it('reads the division out of the names the picker offers', () => {
        expect(DEFAULT_BOX_NAMES.map(name => boxTheme(name))).toEqual(['marketing', 'sales', 'operations', 'support', 'finance', 'personal'])
        expect(boxTheme('Customer Care')).toBe('support')
        expect(boxTheme('New Business')).toBe('sales')
        expect(boxTheme('Supply Chain')).toBe('operations')
        expect(boxTheme('Engineering')).toBe('product')
    })

    it('matches whole words, whatever the case and the accents', () => {
        expect(boxTheme('  MARKETING fr ')).toBe('marketing')
        expect(boxTheme('Comptabilité')).toBe('finance')
        expect(boxTheme('Developers')).toBeNull()
    })

    it('leaves a name that is not a division without a theme', () => {
        expect(boxTheme('Acme')).toBeNull()
        expect(boxTheme('Store')).toBeNull()
        expect(boxTheme('')).toBeNull()
        expect(boxTheme(null)).toBeNull()
    })
})

describe('themeSuggestions', () => {
    it.each(BOX_THEMES)('%s has more jobs that exist than the dialog draws, each named once', theme => {
        const suggestions = themeSuggestions(theme)

        expect(suggestions.length).toBeGreaterThanOrEqual(8)
        expect(new Set(suggestions.map(suggestion => suggestion.name)).size).toBe(suggestions.length)
    })
})

describe('boxSuggestions', () => {
    const ideas = [idea('Guidance Tracker', 'watch'), idea('Demo Prep Brief', 'sales'), idea('Refund Router', 'support')]

    it('leads with the ideas imagined for this Box, then the jobs of its theme', () => {
        const suggestions = boxSuggestions({ boxName: 'Marketing', industry: 'saas', ideas, agentNames: [] })

        expect(suggestions[0].name).toBe('Guidance Tracker')
        expect(suggestions.map(suggestion => suggestion.name)).not.toContain('Demo Prep Brief')
        expect(suggestions[1].id).toBe('default-seo')
    })

    it('puts the jobs written for the industry ahead of the rest of the theme', () => {
        const suggestions = boxSuggestions({ boxName: 'Support', industry: 'ecommerce', ideas: [], agentNames: [] })

        expect(suggestions[0].id).toBe('ecommerce-reviews')
    })

    it('offers every idea then the industry list in a Box whose name says nothing', () => {
        const suggestions = boxSuggestions({ boxName: 'Acme', industry: 'sales', ideas: ideas.slice(0, 2), agentNames: [] })

        expect(suggestions.slice(0, 2).map(suggestion => suggestion.name)).toEqual(['Guidance Tracker', 'Demo Prep Brief'])
        expect(suggestions[2]).toBe(INDUSTRY_AGENT_SUGGESTIONS.sales[0])
        expect(suggestions.length).toBeGreaterThan(SUGGESTION_CARDS)
    })

    it('never names two suggestions alike', () => {
        const suggestions = boxSuggestions({ boxName: 'Support', industry: 'saas', ideas: [idea('Support Assistant', 'support')], agentNames: [] })

        expect(suggestions.filter(suggestion => suggestion.name === 'Support Assistant')).toHaveLength(1)
        expect(suggestions[0].id).toBe('idea-support-assistant')
    })
})

describe('boxCtaLabel', () => {
    it('names the Box when it fits on the pill', () => {
        const t = englishTranslator('builder.isoBoard')
        expect(boxCtaLabel('Marketing', t)).toBe('Explore Marketing templates')
        expect(boxCtaLabel(' Acme ', t)).toBe('Explore Acme templates')
        expect(boxCtaLabel('Research and Development', t)).toBe('Explore templates')
        expect(boxCtaLabel(null, t)).toBe('Explore templates')
    })

    it('measures the translated pill, not the English one', () => {
        const t = createTranslator({ locale: 'fr', messages: { builder: frBuilder }, namespace: 'builder.isoBoard' })
        expect(boxCtaLabel('Marketing', t)).toBe('Explorer les templates Marketing')
        expect(boxCtaLabel('Customer Care', englishTranslator('builder.isoBoard'))).toBe('Explore Customer Care templates')
        expect(boxCtaLabel('Customer Care', t)).toBe('Explorer les templates')
    })
})

describe('boxCtaExamples', () => {
    it('rolls through the first titles the dialog opens on, the ideas of the company first', () => {
        const input = { boxName: 'Finance', industry: 'saas', ideas: [idea('Invoice Chaser', 'backoffice')], agentNames: [] }
        const examples = boxCtaExamples(input)
        const titles = boxSuggestions(input).map(suggestion => suggestion.title)

        expect(examples[0]).toBe('Invoice Chaser')
        expect(examples.length).toBeGreaterThan(1)
        expect(examples.length).toBeLessThanOrEqual(5)
        expect(examples.every(example => titles.includes(example) && example.length <= 28)).toBe(true)
    })

    it('still has something to show for a Box whose name is not a division', () => {
        expect(boxCtaExamples({ boxName: 'Acme', industry: null, ideas: [], agentNames: [] }).length).toBeGreaterThan(1)
    })
})

describe('boxIdeas', () => {
    it('drops an idea once an agent carries its name', () => {
        const ideas = [idea('Refund Router', 'support'), idea('Review Responder', 'support')]

        expect(boxIdeas('Support', ideas, ['refund router ']).map(found => found.name)).toEqual(['Review Responder'])
    })
})
