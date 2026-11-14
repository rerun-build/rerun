import { PLAN_CURRENCY, basePriceCents, cardlessTrialLine, formatAmount, trialChargeLine, trialEndDate, type PriceArm, type TrialCopy } from '@rerun/contracts'

import type { TrialOffer } from './checkout-variant'
import { shortDate } from './dates'

export function trialOfferLine(priceArm: PriceArm, offer: TrialOffer, t: TrialCopy, locale: string, now: Date = new Date()): string {
    const line = offer === 'cardless' ? cardlessTrialLine : trialChargeLine
    return line(t, formatAmount(basePriceCents(priceArm), PLAN_CURRENCY, locale), shortDate(trialEndDate(now), locale))
}
