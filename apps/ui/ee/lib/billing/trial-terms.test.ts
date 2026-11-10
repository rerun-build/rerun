import { cardlessTrialLine, trialChargeLine, trialLimitsCaption } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { trialOfferLine } from './trial-terms'

describe('trial terms', () => {
    const t = englishTranslator('billing.trialOffer')

    it('reads in English exactly as before the catalog', () => {
        expect(trialLimitsCaption(t)).toBe('3 coworkers and 350 credits during the trial.')
        expect(trialChargeLine(t, '$49', '14/11/2026')).toBe('Card required, $0 today. $49 charged on 14/11/2026 unless you cancel before.')
        expect(cardlessTrialLine(t, '$29', '14/11/2026')).toBe('No card needed, $0 today. Add one before 14/11/2026 to keep going at $29/month.')
    })

    it('quotes the price arm and the day the trial ends', () => {
        const now = new Date('2026-11-09T12:00:00Z')
        expect(trialOfferLine('49', 'card_trial', t, 'en', now)).toBe('Card required, $0 today. $49 charged on Nov 14 unless you cancel before.')
        expect(trialOfferLine('29', 'cardless', t, 'en', now)).toBe('No card needed, $0 today. Add one before Nov 14 to keep going at $29/month.')
    })
})
