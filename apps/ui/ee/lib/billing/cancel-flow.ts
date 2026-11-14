import { RENEWAL_REMINDER_LEAD_MS, TRIAL_ENDING_LEAD_MS } from '@/ee/lib/lifecycle/sequences'
import { z } from 'zod'
import { LIST_PRICE_ARM, PLAN_CURRENCY, PRICE_ARMS, basePriceCents, type PriceArm } from './plans'

export const CANCEL_REASONS = ['too_expensive', 'unused', 'too_complex', 'low_quality', 'missing_features', 'switched_service', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export const cancelReasonTextSchema = z.string().trim().min(1, 'Tell us in a few words why you are leaving.').max(1000, 'Keep it under 1,000 characters.')

export const CANCEL_REASON_GLOSS: Record<CancelReason, string> = {
    too_expensive: 'the price, the cost of the model credit, a tight budget, not worth the money',
    unused: 'not using it, no time for it, no need for it anymore, the project it was for ended or is on hold, only wanted to try it',
    too_complex: 'too hard to set up or to understand, could not get a coworker working, got lost',
    low_quality: 'something broke or was unreliable: bugs, errors, slowness, poor results from the coworkers',
    missing_features: 'a feature, an integration or an app they need does not exist',
    switched_service: 'moving to another tool or product, or building it themselves',
    other: 'a real reason that none of the above covers',
}

export const CANCEL_REASON_CHECKS = ['genuine', 'rejected', 'unchecked'] as const
export type CancelReasonCheck = (typeof CANCEL_REASON_CHECKS)[number]

export const CANCEL_COMEBACKS = ['coming_back', 'maybe', 'not_coming_back'] as const
export type CancelComeback = (typeof CANCEL_COMEBACKS)[number]

export type CancelPhase = 'paid' | 'trial'

export type RetentionOfferKind = 'base_1usd' | 'trial_half'

export const RETENTION_CLAIMED_METADATA_KEY = 'retention_offer_claimed_at'
export const CANCEL_COMEBACK_METADATA_KEY = 'cancel_comeback'
export const CANCEL_REASON_CHECK_METADATA_KEY = 'cancel_reason_check'

const BASE_OFFER_PRICE_CENTS = 100

const BASE_OFFER_COUPON_ID = 'rerun_retention_base_1usd'
const TRIAL_OFFER_COUPON_ID = 'rerun_retention_trial_half'

export function retentionCouponId(kind: RetentionOfferKind, arm: PriceArm): string {
    if (kind === 'trial_half') return TRIAL_OFFER_COUPON_ID
    return arm === LIST_PRICE_ARM ? BASE_OFFER_COUPON_ID : `${BASE_OFFER_COUPON_ID}_${arm}`
}

function baseOfferAmountOff(arm: PriceArm): number {
    return basePriceCents(arm) - BASE_OFFER_PRICE_CENTS
}

export function retentionCouponParams(kind: RetentionOfferKind, arm: PriceArm) {
    if (kind === 'trial_half') return { percent_off: 50, duration: 'once', name: '50% off your first month' } as const
    return { amount_off: baseOfferAmountOff(arm), currency: PLAN_CURRENCY, duration: 'once', name: 'Next month for $1' } as const
}

export function cancelFlowPhase(status: string | null | undefined, hasPaymentMethod: boolean): CancelPhase | null {
    if (status === 'active') return 'paid'
    if (status === 'trialing' && hasPaymentMethod) return 'trial'
    return null
}

export function reminderDate(phase: CancelPhase, endsAt: Date, now: Date): Date | null {
    const lead = phase === 'paid' ? RENEWAL_REMINDER_LEAD_MS : TRIAL_ENDING_LEAD_MS
    const at = new Date(endsAt.getTime() - lead)
    return at > now ? at : null
}

export function paidLeftCents(monthlyCents: number, periodStart: Date, periodEnd: Date, now: Date): number {
    const length = periodEnd.getTime() - periodStart.getTime()
    if (length <= 0) return 0
    const left = Math.min(1, Math.max(0, (periodEnd.getTime() - now.getTime()) / length))
    return Math.round(monthlyCents * left)
}

export function retentionOfferFor(phase: CancelPhase, subscription: { metadata: Record<string, string> | null | undefined; discountCount: number; legacyBase: boolean }): RetentionOfferKind | null {
    if (subscription.metadata?.[RETENTION_CLAIMED_METADATA_KEY]) return null
    if (subscription.discountCount > 0 || subscription.legacyBase) return null
    return phase === 'paid' ? 'base_1usd' : 'trial_half'
}

export function retentionOfferOfCoupon(couponId: string | null | undefined): RetentionOfferKind | null {
    if (PRICE_ARMS.some(arm => couponId === retentionCouponId('base_1usd', arm))) return 'base_1usd'
    if (couponId === TRIAL_OFFER_COUPON_ID) return 'trial_half'
    return null
}

export function offerPriceCents(kind: RetentionOfferKind, monthlyCents: number, arm: PriceArm): number {
    if (kind === 'base_1usd') return monthlyCents - baseOfferAmountOff(arm)
    return Math.round(monthlyCents / 2)
}

export function addOneMonth(date: Date): Date {
    const next = new Date(date)
    next.setUTCMonth(next.getUTCMonth() + 1)
    return next
}
