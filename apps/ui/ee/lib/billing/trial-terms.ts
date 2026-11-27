import { PLAN_CURRENCY, basePriceCents, cardlessTrialLine, formatAmount, trialChargeLine, trialEndDate, type TrialCopy } from '@rerun/contracts'

import type { TrialOffer } from './checkout-variant'
import { shortDate } from './dates'

// The trial offer in its one sentence, for a trial that would start now: either arm of the trial
// test rolls into the monthly base plan.
export function trialOfferLine(offer: TrialOffer, t: TrialCopy, locale: string, now: Date = new Date()): string {
    const line = offer === 'cardless' ? cardlessTrialLine : trialChargeLine
    return line(t, formatAmount(basePriceCents(), PLAN_CURRENCY, locale), shortDate(trialEndDate(now), locale))
}
