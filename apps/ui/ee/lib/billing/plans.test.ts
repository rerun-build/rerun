import { describe, expect, it } from 'vitest'
import {
    BASE_PLAN_SLUG,
    MICROS_PER_USD,
    baseLimitsToColumns,
    basePriceCents,
    isClaudePlanOffered,
    isLifetimePlan,
    isModelAccess,
    LIFETIME_TIERS,
    lifetimeLimitsToColumns,
    lifetimeTier,
    lifetimeTierToColumns,
    perMonthCents,
    planDiscountCents,
    planPriceCents,
    rerunCreditTotalMicros,
    yearlyDiscountPercent,
} from './plans'

describe('baseLimitsToColumns', () => {
    it('gives the plan its own five dollars of monthly credit, with unlimited coworkers and seats', () => {
        expect(baseLimitsToColumns()).toEqual({ max_agents: null, max_seats: null, model_access: 'best', custom_integrations: true, api_access: true, rerun_budget_micros: 5 * MICROS_PER_USD })
    })
})

describe('plan prices', () => {
    it('bills the base plus every add-on, monthly or yearly', () => {
        expect(planPriceCents({ linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 }, 'monthly')).toBe(2900 + 2 * 900 + 900)
        expect(planPriceCents({ linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 }, 'yearly')).toBe(27600 + 2 * 10800 + 10800)
    })

    it('brings a yearly plan back to one month', () => {
        expect(perMonthCents({ linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 }, 'yearly')).toBe(2300)
        expect(perMonthCents({ linkedin_slot: 1, whatsapp_slot: 0, storage_pack: 0 }, 'monthly')).toBe(3800)
    })

    it('rounds the yearly saving down to a whole percentage, never promising more than it gives', () => {
        expect(yearlyDiscountPercent()).toBe(20)
    })
})

describe('the base price', () => {
    it('is $29 a month or $276 a year', () => {
        expect(basePriceCents()).toBe(2900)
        expect(basePriceCents('monthly')).toBe(2900)
        expect(basePriceCents('yearly')).toBe(27600)
    })
})

describe('rerunCreditTotalMicros', () => {
    it('measures against the budget plus the top-up left', () => {
        expect(rerunCreditTotalMicros({ rerun_budget_micros: 5_000_000, rerun_used_micros: 1_000_000, rerun_topup_micros: 2_000_000 })).toBe(7_000_000)
    })

    it('measures against what was spent when it went past the budget', () => {
        expect(rerunCreditTotalMicros({ rerun_budget_micros: 5_000_000, rerun_used_micros: 6_500_000, rerun_topup_micros: 1_000_000 })).toBe(7_500_000)
    })

    it('is zero when every column is empty', () => {
        expect(rerunCreditTotalMicros({ rerun_budget_micros: null, rerun_used_micros: null, rerun_topup_micros: null })).toBe(0)
        expect(rerunCreditTotalMicros(null)).toBe(0)
    })
})

describe('isModelAccess', () => {
    it('accepts only the known model access values', () => {
        expect(isModelAccess('best')).toBe(true)
        expect(isModelAccess('self_hosted')).toBe(true)
        expect(isModelAccess('pro')).toBe(false)
        expect(isModelAccess('')).toBe(false)
        expect(isModelAccess(null)).toBe(false)
    })
})

describe('isLifetimePlan', () => {
    it('is true for both lifetime plans, and only for them', () => {
        expect(isLifetimePlan({ plan: 'lifetime' })).toBe(true)
        expect(isLifetimePlan({ plan: 'lifetime_restricted' })).toBe(true)
        expect(isLifetimePlan({ plan: BASE_PLAN_SLUG })).toBe(false)
        expect(isLifetimePlan({ plan: null })).toBe(false)
        expect(isLifetimePlan(null)).toBe(false)
    })
})

describe('lifetime tiers', () => {
    it('caps the first tier at three seats, without the API, and opens both on the next ones', () => {
        expect(lifetimeTierToColumns(1)).toEqual({ lifetime_tier: 1, max_seats: 3, api_access: false })
        expect(lifetimeTierToColumns(2)).toEqual({ lifetime_tier: 2, max_seats: null, api_access: true })
        expect(lifetimeTierToColumns(3)).toEqual({ lifetime_tier: 3, max_seats: null, api_access: true })
    })

    it('restricts nothing without a tier', () => {
        expect(lifetimeTierToColumns(null)).toEqual({ lifetime_tier: null, max_seats: null, api_access: true })
    })

    it('covers three workspaces on the third tier only', () => {
        expect(LIFETIME_TIERS.map(tier => tier.workspaces)).toEqual([1, 1, 3])
        expect(LIFETIME_TIERS.map(tier => tier.prioritySupport)).toEqual([false, false, true])
    })

    it('keeps coworkers unlimited and the Rerun credit at zero on every tier', () => {
        for (const tier of [null, 1, 2, 3] as const) expect(lifetimeLimitsToColumns(tier)).toMatchObject({ max_agents: null, rerun_budget_micros: 0, lifetime_tier: tier })
    })

    it('reads an unknown stored value as no tier', () => {
        expect(lifetimeTier(9)).toBeNull()
        expect(lifetimeTier(null)).toBeNull()
        expect(lifetimeTier(2)?.priceUsd).toBe(249)
    })
})

describe('isClaudePlanOffered', () => {
    it('leaves the Claude plan out of the restricted lifetime plan only', () => {
        expect(isClaudePlanOffered({ plan: 'lifetime_restricted' })).toBe(false)
        expect(isClaudePlanOffered({ plan: 'lifetime' })).toBe(true)
        expect(isClaudePlanOffered({ plan: BASE_PLAN_SLUG })).toBe(true)
        expect(isClaudePlanOffered({ plan: null })).toBe(true)
        expect(isClaudePlanOffered(null)).toBe(true)
    })
})

describe('planDiscountCents', () => {
    const legacy = { interval: 'monthly' as const, monthlyDiscountCents: 2500 }

    it('keeps a legacy base price or a permanent promo on the same interval', () => {
        expect(planDiscountCents(legacy, 'monthly')).toBe(2500)
        expect(planPriceCents({ linkedin_slot: 1, whatsapp_slot: 0, storage_pack: 0 }, 'monthly') - planDiscountCents(legacy, 'monthly')).toBe(1300)
    })

    it('promises nothing past a change of interval', () => {
        expect(planDiscountCents(legacy, 'yearly')).toBe(0)
    })
})
