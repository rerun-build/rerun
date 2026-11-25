import { TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import messages from '@rerun/i18n/messages/en/onboarding.json'
import { promiseKey } from './promise-key'
import { MAX_STARTER_PICKS, SECTOR_PACKS, STARTER_PACKS, starterPack } from './starter-packs'

const PACKS = [...Object.values(STARTER_PACKS), ...Object.values(SECTOR_PACKS)]

describe('STARTER_PACKS', () => {
    it('offers every industry the welcome card can settle on more cards than the trial can hire', () => {
        for (const industry of TEMPLATE_CATEGORIES) expect(STARTER_PACKS[industry].length).toBeGreaterThan(MAX_STARTER_PICKS)
        for (const pack of Object.values(SECTOR_PACKS)) expect(pack.length).toBeGreaterThan(MAX_STARTER_PICKS)
    })

    // Two cards on one template would install a single coworker for two picks.
    it('never puts the same template on two cards of one pack', () => {
        for (const pack of PACKS) {
            const slugs = pack.map(card => card.template)
            expect(new Set(slugs).size).toBe(slugs.length)
        }
    })

    it('gives someone here for themselves a pack of their own, whatever the industry they were filed into', () => {
        expect(starterPack('productivity', 'student')).toBe(SECTOR_PACKS.student)
        expect(starterPack('productivity', 'freelance')).toBe(STARTER_PACKS.productivity)
        expect(starterPack('productivity', 'student').map(card => card.template)).not.toContain('collections-officer')
    })

    it('has every promise in the language packs, word for word', () => {
        const promises: Record<string, string> = messages.promises
        for (const card of PACKS.flat()) expect(promises[promiseKey(card.promise)]).toBe(card.promise)
    })

    it('falls back on the pack every company needs when no industry was settled', () => {
        expect(starterPack(null)).toBe(STARTER_PACKS.other)
        expect(starterPack('real-estate')[0]).toMatchObject({ template: 'real-estate-agent', promise: 'Find owners about to sell' })
    })
})
