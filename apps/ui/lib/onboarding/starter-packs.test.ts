import { TEMPLATE_CATEGORIES } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'

import { MAX_STARTER_PICKS, STARTER_PACKS, starterPack } from './starter-packs'

describe('STARTER_PACKS', () => {
    it('offers every industry the welcome card can settle on more cards than the trial can hire', () => {
        for (const industry of TEMPLATE_CATEGORIES) expect(STARTER_PACKS[industry].length).toBeGreaterThan(MAX_STARTER_PICKS)
    })

    it('never puts the same template on two cards of one pack', () => {
        for (const industry of TEMPLATE_CATEGORIES) {
            const slugs = STARTER_PACKS[industry].map(card => card.template)
            expect(new Set(slugs).size).toBe(slugs.length)
        }
    })

    it('falls back on the pack every company needs when no industry was settled', () => {
        expect(starterPack(null)).toBe(STARTER_PACKS.other)
        expect(starterPack('real-estate')[0]).toMatchObject({ template: 'real-estate-agent', promise: 'Find owners about to sell' })
    })
})
