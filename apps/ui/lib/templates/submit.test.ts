import { type TemplateDocument, templateDocumentSchema } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { templateSubmitBlockers, templateSubmitChecklist } from './submit'

const t = englishTranslator('templates.expert.footer')

function doc(overrides: Record<string, unknown> = {}): TemplateDocument {
    return templateDocumentSchema.parse({
        slug: 'kit',
        title: 'Kit',
        tagline: 'Tag',
        longDescription: 'Desc',
        metaDescription: 'x'.repeat(130),
        agents: [{ key: 'scout', name: 'Scout', setupRequired: false }],
        ...overrides,
    })
}

describe('templateSubmitChecklist', () => {
    it('meets every requirement of a complete free template, with no payout line', () => {
        const checklist = templateSubmitChecklist(doc(), t)
        expect(checklist.every(r => r.met)).toBe(true)
        expect(checklist.map(r => r.label)).toEqual(['A title', 'A tagline', 'A description', 'A meta description of 120 to 155 characters', 'At least one captured coworker', 'An install answer for every coworker'])
    })

    it('treats whitespace as missing text', () => {
        expect(templateSubmitBlockers(doc({ title: ' ', tagline: '  ', longDescription: '\n' }), t)).toEqual(['a title', 'a tagline', 'a description'])
    })

    it('blocks the install answer both with no agent and with an unanswered one', () => {
        expect(templateSubmitBlockers(doc({ agents: [] }), t)).toEqual(['at least one captured coworker', 'an install answer for every coworker'])
        const unanswered = doc({ agents: [{ key: 'a', name: 'A', setupRequired: true }, { key: 'b', name: 'B' }] })
        expect(templateSubmitBlockers(unanswered, t)).toEqual(['an install answer for every coworker'])
    })

    it('asks for a meta description inside the search snippet band', () => {
        const blocker = 'a meta description of 120 to 155 characters'
        for (const length of [0, 119, 156]) expect(templateSubmitBlockers(doc({ metaDescription: 'x'.repeat(length) }), t)).toEqual([blocker])
        for (const length of [120, 155]) expect(templateSubmitBlockers(doc({ metaDescription: 'x'.repeat(length) }), t)).toEqual([])
    })

    it('asks a paid template for payouts, unready by default', () => {
        const paid = doc({ pricingModel: 'recurring', priceAmountCents: 900 })
        expect(templateSubmitBlockers(paid, t)).toEqual(['a stripe account that can receive payouts'])
        expect(templateSubmitBlockers(paid, t, { payoutsReady: true })).toEqual([])
    })
})
