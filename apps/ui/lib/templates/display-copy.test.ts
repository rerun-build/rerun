import { formatAmount, priceCtaLabel, priceLabel, templateCardCtaLabel, templateCategoryLabel, type TemplatePricing } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { creatorKindLabel } from './library-view'
import { templateStatusLabel } from './status'

const FREE: TemplatePricing = { model: 'free', amountCents: 0, currency: 'usd' }
const ONCE: TemplatePricing = { model: 'one_time', amountCents: 2900, currency: 'usd' }
const MONTHLY: TemplatePricing = { model: 'recurring', amountCents: 1950, currency: 'usd' }

describe('template prices', () => {
    const t = englishTranslator('templates.price')

    it('reads in English exactly as before the catalog', () => {
        expect(priceLabel(FREE, t, 'en')).toBe('Free')
        expect(priceLabel(ONCE, t, 'en')).toBe('$29')
        expect(priceLabel(MONTHLY, t, 'en')).toBe('$19.50/mo')
        expect(priceCtaLabel(FREE, 3, t, 'en')).toBe('Use for free')
        expect(priceCtaLabel(ONCE, 1, t, 'en')).toBe('Hire this coworker · $29')
        expect(priceCtaLabel(ONCE, 0, t, 'en')).toBe('Hire this coworker · $29')
        expect(priceCtaLabel(MONTHLY, 3, t, 'en')).toBe('Hire these 3 coworkers · $19.50/mo')
        expect(templateCardCtaLabel(FREE, t, 'en')).toBe('Use for free')
        expect(templateCardCtaLabel(MONTHLY, t, 'en')).toBe('Hire · $19.50/mo')
    })

    it('writes the amount the way the reader writes it', () => {
        expect(formatAmount(2900, 'usd')).toBe('$29')
        expect(formatAmount(2900, 'usd', 'fr')).toBe('29 $US')
    })
})

describe('template labels', () => {
    it('names a category, an unknown one as Other', () => {
        const t = englishTranslator('templates.categories')
        expect(templateCategoryLabel('real-estate', t)).toBe('Real estate')
        expect(templateCategoryLabel('legal', t)).toBe('Legal & compliance')
        expect(templateCategoryLabel('gardening', t)).toBe('Other')
    })

    it('names a status, and title cases one the catalog does not know', () => {
        const t = englishTranslator('templates.status')
        expect(templateStatusLabel('in_review', t)).toBe('In review')
        expect(templateStatusLabel('published', t)).toBe('Published')
        expect(templateStatusLabel('retired', t)).toBe('Retired')
    })

    it('names the kind of creator', () => {
        const t = englishTranslator('templates.creatorKind')
        expect(creatorKindLabel('freelancer', t)).toBe('Freelancer')
        expect(creatorKindLabel('studio', t)).toBe('Studio')
    })
})
