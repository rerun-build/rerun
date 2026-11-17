import { describe, expect, it } from 'vitest'

import { headlineCaseProblems, isPageTitleKey } from './catalog.mjs'

describe('headlineCaseProblems', () => {
    it('accepts a headline-case title', () => {
        expect(headlineCaseProblems('AI Agents for Recruiting: Screening, Interviews, Follow-Up')).toEqual([])
        expect(headlineCaseProblems('Rerun vs n8n: AI Agents or Workflows? (2026)')).toEqual([])
        expect(headlineCaseProblems('Human in the Loop: Your AI Agent Asks Before It Acts')).toEqual([])
    })

    it('capitalizes a short word that opens the title or follows a colon', () => {
        expect(headlineCaseProblems('Computer Use: An AI Agent That Clicks Through Your Apps')).toEqual([])
        expect(headlineCaseProblems('Computer Use: an AI Agent')).toEqual(['an'])
    })

    it('names the words left in sentence case', () => {
        expect(headlineCaseProblems('Become a Rerun expert')).toEqual(['expert'])
        expect(headlineCaseProblems('AI agents for e-commerce')).toEqual(['agents', 'e-commerce'])
        expect(headlineCaseProblems('AI Agents for E-commerce')).toEqual([])
    })

    it('lets a short function word take either case', () => {
        expect(headlineCaseProblems('Write Daily Construction Site Reports with AI')).toEqual([])
        expect(headlineCaseProblems('Organize, Archive and Clean Up Your Files')).toEqual([])
        expect(headlineCaseProblems('How to Deploy AI Agents: A Step-by-Step Guide')).toEqual([])
    })

    it('skips ICU arguments, numbers and lowercase product names', () => {
        expect(headlineCaseProblems('{count, number}+ Tools and Integrations, Included in the Plan')).toEqual([])
        expect(headlineCaseProblems('AI Agents That Run 24/7 on Servers in Europe')).toEqual([])
    })
})

describe('isPageTitleKey', () => {
    it('matches the keys that become a page title', () => {
        expect(isPageTitleKey('landingFeatures.items.tools.metaTitle')).toBe(true)
        expect(isPageTitleKey('landingCompare.hub.title')).toBe(true)
        expect(isPageTitleKey('landingPricing.lifetime.seo.title')).toBe(true)
        expect(isPageTitleKey('landingCommunity.metadata.program.title')).toBe(true)
    })

    it('leaves the headings shown on the page alone', () => {
        expect(isPageTitleKey('landingCommunity.program.hero.title')).toBe(false)
        expect(isPageTitleKey('landingPricing.faq.title')).toBe(false)
    })
})
