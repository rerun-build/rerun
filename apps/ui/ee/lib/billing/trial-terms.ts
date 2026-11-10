import { PLAN_CURRENCY, basePriceCents, cardlessTrialLine, formatAmount, trialChargeLine, trialEndDate, type PriceArm, type TrialCopy } from '@rerun/contracts'

import type { TrialOffer } from './checkout-variant'
import { shortDate } from './dates'

// The trial offer in its one sentence, for a trial that would start now: either arm of the trial
// test rolls into the monthly base plan at the workspace's price arm.
export function trialOfferLine(priceArm: PriceArm, offer: TrialOffer, t: TrialCopy, locale: string, now: Date = new Date()): string {
    const line = offer === 'cardless' ? cardlessTrialLine : trialChargeLine
    return line(t, formatAmount(basePriceCents(priceArm), PLAN_CURRENCY, locale), shortDate(trialEndDate(now), locale))
}
