// The rules of the in-app cancel flow, kept pure so the dialog, the server actions and the tests
// read the same answers. Server-safe: no Stripe client, no React.
import { RENEWAL_REMINDER_LEAD_MS, TRIAL_ENDING_LEAD_MS } from '@/ee/lib/lifecycle/sequences'
import { z } from 'zod'
import { PLAN_CURRENCY } from './plans'

// Stripe's `cancellation_details.feedback` values, minus `customer_service`: there is no support
// interaction in the product for it to be about.
export const CANCEL_REASONS = ['too_expensive', 'unused', 'too_complex', 'low_quality', 'missing_features', 'switched_service', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

// What the customer writes about why they leave, checked the same way in the dialog and on the server.
// Its messages are codes of the `errors` namespace, so the action sends the refusal translated.
export const cancelReasonTextSchema = z.string().trim().min(1, 'cancelReasonRequired').max(1000, 'cancelReasonTooLong')

// What each reason covers, for the model that files a customer's own words under one of them.
export const CANCEL_REASON_GLOSS: Record<CancelReason, string> = {
    too_expensive: 'the price, the cost of the model credit, a tight budget, not worth the money',
    unused: 'not using it, no time for it, no need for it anymore, the project it was for ended or is on hold, only wanted to try it',
    too_complex: 'too hard to set up or to understand, could not get a coworker working, got lost',
    low_quality: 'something broke or was unreliable: bugs, errors, slowness, poor results from the coworkers',
    missing_features: 'a feature, an integration or an app they need does not exist',
    switched_service: 'moving to another tool or product, or building it themselves',
    other: 'a real reason that none of the above covers',
}

// How the customer's own words were read: `rejected` went through on the last try allowed,
// `unchecked` means the model did not answer.
export const CANCEL_REASON_CHECKS = ['genuine', 'rejected', 'unchecked'] as const
export type CancelReasonCheck = (typeof CANCEL_REASON_CHECKS)[number]

export const CANCEL_COMEBACKS = ['coming_back', 'maybe', 'not_coming_back'] as const
export type CancelComeback = (typeof CANCEL_COMEBACKS)[number]

// `trial` is a trial with a card: the one whose end charges a card. A trial without one expires on
// its own and has nothing to cancel, so it gets no flow at all.
export type CancelPhase = 'paid' | 'trial'

export type RetentionOfferKind = 'base_1usd' | 'trial_half'

// Written on the subscription when an offer is claimed: an offer is given once per workspace, and
// the plan subscription is the workspace's for life.
export const RETENTION_CLAIMED_METADATA_KEY = 'retention_offer_claimed_at'
export const CANCEL_COMEBACK_METADATA_KEY = 'cancel_comeback'
export const CANCEL_REASON_CHECK_METADATA_KEY = 'cancel_reason_check'

const BASE_OFFER_PRICE_CENTS = 100

const BASE_OFFER_COUPON_ID = 'rerun_retention_base_1usd'
const TRIAL_OFFER_COUPON_ID = 'rerun_retention_trial_half'

// The $49 base kept the id the coupon was first minted under, before the price test.
const HISTORIC_BASE_OFFER_CENTS = 4900

// Fixed ids so the coupon is created once and found again by id, never minted twice. The $1 offer
// is an amount off the base the subscription is billed, so each base price has its own coupon, named
// after its dollars: the one sized for a workspace still on $49 would take more than the whole base
// plan off a $29 one.
export function retentionCouponId(kind: RetentionOfferKind, baseCents: number): string {
    if (kind === 'trial_half') return TRIAL_OFFER_COUPON_ID
    return baseCents === HISTORIC_BASE_OFFER_CENTS ? BASE_OFFER_COUPON_ID : `${BASE_OFFER_COUPON_ID}_${Math.round(baseCents / 100)}`
}

function baseOfferAmountOff(baseCents: number): number {
    return Math.max(0, baseCents - BASE_OFFER_PRICE_CENTS)
}

export function retentionCouponParams(kind: RetentionOfferKind, baseCents: number) {
    if (kind === 'trial_half') return { percent_off: 50, duration: 'once', name: '50% off your first month' } as const
    return { amount_off: baseOfferAmountOff(baseCents), currency: PLAN_CURRENCY, duration: 'once', name: 'Next month for $1' } as const
}

export function cancelFlowPhase(status: string | null | undefined, hasPaymentMethod: boolean): CancelPhase | null {
    if (status === 'active') return 'paid'
    if (status === 'trialing' && hasPaymentMethod) return 'trial'
    return null
}

// When the "remind me" email goes out, or null once that moment has passed: the first screen of the
// flow is then skipped, since it would promise an email that can no longer be sent in time.
export function reminderDate(phase: CancelPhase, endsAt: Date, now: Date): Date | null {
    const lead = phase === 'paid' ? RENEWAL_REMINDER_LEAD_MS : TRIAL_ENDING_LEAD_MS
    const at = new Date(endsAt.getTime() - lead)
    return at > now ? at : null
}

// The share of this period's bill that is still ahead, which leaving now does not give back.
export function paidLeftCents(monthlyCents: number, periodStart: Date, periodEnd: Date, now: Date): number {
    const length = periodEnd.getTime() - periodStart.getTime()
    if (length <= 0) return 0
    const left = Math.min(1, Math.max(0, (periodEnd.getTime() - now.getTime()) / length))
    return Math.round(monthlyCents * left)
}

// One offer per workspace, never stacked on another discount: a grandfathered price is a discount
// too, and $48 off a $24 base would hand out a free month.
export function retentionOfferFor(phase: CancelPhase, subscription: { metadata: Record<string, string> | null | undefined; discountCount: number; legacyBase: boolean }): RetentionOfferKind | null {
    if (subscription.metadata?.[RETENTION_CLAIMED_METADATA_KEY]) return null
    if (subscription.discountCount > 0 || subscription.legacyBase) return null
    return phase === 'paid' ? 'base_1usd' : 'trial_half'
}

export function retentionOfferOfCoupon(couponId: string | null | undefined): RetentionOfferKind | null {
    if (couponId === BASE_OFFER_COUPON_ID || couponId?.startsWith(`${BASE_OFFER_COUPON_ID}_`)) return 'base_1usd'
    if (couponId === TRIAL_OFFER_COUPON_ID) return 'trial_half'
    return null
}

// What the next invoice comes to under the offer, before tax. The $1 covers the base plan only:
// add-ons keep their price.
export function offerPriceCents(kind: RetentionOfferKind, monthlyCents: number, baseCents: number): number {
    if (kind === 'base_1usd') return monthlyCents - baseOfferAmountOff(baseCents)
    return Math.round(monthlyCents / 2)
}

export function addOneMonth(date: Date): Date {
    const next = new Date(date)
    next.setUTCMonth(next.getUTCMonth() + 1)
    return next
}
