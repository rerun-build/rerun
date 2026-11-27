import { TRIAL_ACTIVE_AGENTS, TRIAL_CREDITS, TRIAL_DAYS } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { checkoutTerms } from './checkout-terms'

const NOW = new Date('2026-10-12T12:00:00Z')

describe('checkoutTerms', () => {
    it('offers the free trial behind the card form to a workspace that never had one', () => {
        const terms = checkoutTerms({ trialSpent: false, trialNeedsCard: true }, NOW)
        expect(terms).toContain(`${TRIAL_DAYS} days free, card required`)
        expect(terms).toContain('card form')
        expect(terms).toContain('$0 is charged today')
        expect(terms).not.toContain('no card')
    })

    it('starts the trial without a card on the cardless arm of the trial test', () => {
        const terms = checkoutTerms({ trialSpent: false, trialNeedsCard: false }, NOW)
        expect(terms).toContain(`${TRIAL_DAYS} days free and no card needed`)
        expect(terms).toContain('add a card before Oct 17')
        expect(terms).not.toContain('card form')
    })

    it('says when the card is charged and what the trial holds', () => {
        const terms = checkoutTerms({ trialSpent: false, trialNeedsCard: true }, NOW)
        expect(terms).toContain('charged on Oct 17')
        expect(terms).toContain(`${TRIAL_ACTIVE_AGENTS} coworkers at once with ${TRIAL_CREDITS} credits of AI usage`)
    })

    it('never says free to a workspace whose trial is spent', () => {
        const terms = checkoutTerms({ trialSpent: true, trialNeedsCard: true }, NOW)
        expect(terms).toContain('billed today')
        expect(terms).not.toContain('days free')
    })

    it('quotes the one price of the plan, trial spent or not', () => {
        expect(checkoutTerms({ trialSpent: false, trialNeedsCard: true }, NOW)).toContain('$29 a month')
        expect(checkoutTerms({ trialSpent: true, trialNeedsCard: true }, NOW)).toContain('$29 a month')
    })
})
