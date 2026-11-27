import { describe, expect, it } from 'vitest'
import { RETENTION_CLAIMED_METADATA_KEY, addOneMonth, cancelReasonTextSchema, cancelFlowPhase, offerPriceCents, paidLeftCents, reminderDate, retentionCouponId, retentionCouponParams, retentionOfferFor, retentionOfferOfCoupon } from './cancel-flow'

const DAY = 24 * 60 * 60_000
const NOW = new Date('2026-10-02T12:00:00Z')
const ahead = (ms: number) => new Date(NOW.getTime() + ms)

describe('cancelFlowPhase', () => {
    it('opens the paid flow on an active subscription and the trial flow on a trial with a card', () => {
        expect(cancelFlowPhase('active', true)).toBe('paid')
        expect(cancelFlowPhase('trialing', true)).toBe('trial')
    })

    it('has no flow for a trial without a card, which ends on its own, nor for a late payment', () => {
        expect(cancelFlowPhase('trialing', false)).toBeNull()
        expect(cancelFlowPhase('past_due', true)).toBeNull()
        expect(cancelFlowPhase('canceled', true)).toBeNull()
        expect(cancelFlowPhase(null, false)).toBeNull()
    })
})

describe('reminderDate', () => {
    it('reminds a paying customer a week before the renewal', () => {
        expect(reminderDate('paid', ahead(27 * DAY), NOW)).toEqual(ahead(20 * DAY))
    })

    it('reminds a trial the day before its first charge', () => {
        expect(reminderDate('trial', ahead(2 * DAY), NOW)).toEqual(ahead(DAY))
    })

    it('offers no reminder once its moment has passed', () => {
        expect(reminderDate('paid', ahead(5 * DAY), NOW)).toBeNull()
        expect(reminderDate('trial', ahead(20 * 60 * 60_000), NOW)).toBeNull()
    })
})

describe('paidLeftCents', () => {
    it('is the share of the period still ahead', () => {
        expect(paidLeftCents(4900, ahead(-3 * DAY), ahead(27 * DAY), NOW)).toBe(4410)
    })

    it('stays within the bill on dates outside the period', () => {
        expect(paidLeftCents(4900, ahead(DAY), ahead(30 * DAY), NOW)).toBe(4900)
        expect(paidLeftCents(4900, ahead(-30 * DAY), ahead(-DAY), NOW)).toBe(0)
        expect(paidLeftCents(4900, NOW, NOW, NOW)).toBe(0)
    })
})

describe('retentionOfferFor', () => {
    const clean = { metadata: {}, discountCount: 0, legacyBase: false }

    it('offers next month for $1 to a paying customer and half off to a trial', () => {
        expect(retentionOfferFor('paid', clean)).toBe('base_1usd')
        expect(retentionOfferFor('trial', clean)).toBe('trial_half')
    })

    it('never offers twice to the same workspace', () => {
        expect(retentionOfferFor('paid', { ...clean, metadata: { [RETENTION_CLAIMED_METADATA_KEY]: '2026-09-01T00:00:00Z' } })).toBeNull()
    })

    it('never stacks on another discount, a grandfathered price included', () => {
        expect(retentionOfferFor('paid', { ...clean, discountCount: 1 })).toBeNull()
        expect(retentionOfferFor('paid', { ...clean, legacyBase: true })).toBeNull()
    })
})

describe('offerPriceCents', () => {
    it('takes the base plan down to $1 and leaves the add-ons at full price', () => {
        expect(offerPriceCents('base_1usd', 4900, 4900)).toBe(100)
        expect(offerPriceCents('base_1usd', 6900, 4900)).toBe(2100)
    })

    it('takes a $29 base plan down to $1 too, never below', () => {
        expect(offerPriceCents('base_1usd', 2900, 2900)).toBe(100)
        expect(offerPriceCents('base_1usd', 3900, 2900)).toBe(1100)
    })

    it('halves the whole first invoice of a trial', () => {
        expect(offerPriceCents('trial_half', 4900, 4900)).toBe(2450)
        expect(offerPriceCents('trial_half', 2900, 2900)).toBe(1450)
    })
})

describe('the retention coupon of each base price', () => {
    it('keeps the historic id for a workspace still on $49 and names the others after their dollars', () => {
        expect(retentionCouponId('base_1usd', 4900)).toBe('rerun_retention_base_1usd')
        expect(retentionCouponId('base_1usd', 2900)).toBe('rerun_retention_base_1usd_29')
        expect(retentionCouponId('trial_half', 2900)).toBe('rerun_retention_trial_half')
    })

    it('sizes the amount off on the base the subscription is billed', () => {
        expect(retentionCouponParams('base_1usd', 4900)).toMatchObject({ amount_off: 4800 })
        expect(retentionCouponParams('base_1usd', 2900)).toMatchObject({ amount_off: 2800 })
        expect(retentionCouponParams('trial_half', 2900)).toMatchObject({ percent_off: 50 })
    })
})

describe('retentionOfferOfCoupon', () => {
    it('recognises only the retention coupons', () => {
        expect(retentionOfferOfCoupon('rerun_retention_base_1usd')).toBe('base_1usd')
        expect(retentionOfferOfCoupon('rerun_retention_base_1usd_29')).toBe('base_1usd')
        expect(retentionOfferOfCoupon('rerun_retention_base_1usd_39')).toBe('base_1usd')
        expect(retentionOfferOfCoupon('rerun_retention_base_1usdx')).toBeNull()
        expect(retentionOfferOfCoupon('rerun_retention_trial_half')).toBe('trial_half')
        expect(retentionOfferOfCoupon('LAUNCH20')).toBeNull()
        expect(retentionOfferOfCoupon(null)).toBeNull()
    })
})

describe('addOneMonth', () => {
    it('moves to the same day of the next month', () => {
        expect(addOneMonth(new Date('2026-10-29T08:00:00Z')).toISOString()).toBe('2026-11-29T08:00:00.000Z')
    })
})

describe('cancelReasonTextSchema', () => {
    const messageOf = (text: string) => cancelReasonTextSchema.safeParse(text).error?.issues[0]?.message

    it('asks for a reason in plain words when the answer is empty or blank', () => {
        expect(messageOf('')).toBe('cancelReasonRequired')
        expect(messageOf('   ')).toBe('cancelReasonRequired')
    })

    it('says how long an answer may be', () => {
        expect(messageOf('a'.repeat(1001))).toBe('cancelReasonTooLong')
    })

    it('takes a written reason', () => {
        expect(cancelReasonTextSchema.safeParse('Too expensive for us').success).toBe(true)
    })
})
