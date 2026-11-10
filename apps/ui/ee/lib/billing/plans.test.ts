import { describe, expect, it } from 'vitest'
import {
    BASE_PLAN_SLUG,
    MICROS_PER_USD,
    baseLimitsToColumns,
    basePriceCents,
    isLifetimePlan,
    isModelAccess,
    parsePriceArm,
    perMonthCents,
    planDiscountCents,
    planPriceCents,
    quantitiesToColumns,
    rerunCreditTotalMicros,
    yearlyDiscountPercent,
} from './plans'

describe('quantitiesToColumns', () => {
    it('derives the base plan limits from zero add-ons, with unlimited coworkers and seats', () => {
        expect(baseLimitsToColumns()).toEqual({ max_agents: null, max_seats: null, model_access: 'best', custom_integrations: true, rerun_budget_micros: 5 * MICROS_PER_USD })
    })

    it('adds ten dollars per credit pack, and never caps the coworkers', () => {
        expect(quantitiesToColumns({ credit_pack: 3, linkedin_slot: 2, whatsapp_slot: 0 })).toEqual({
            max_agents: null,
            max_seats: null,
            model_access: 'best',
            custom_integrations: true,
            rerun_budget_micros: 35 * MICROS_PER_USD,
        })
    })
})

describe('plan prices', () => {
    it('bills the base plus every add-on, monthly or yearly', () => {
        expect(planPriceCents({ credit_pack: 1, linkedin_slot: 2, whatsapp_slot: 0 }, 'monthly')).toBe(4900 + 1000 + 2 * 900)
        expect(planPriceCents({ credit_pack: 1, linkedin_slot: 2, whatsapp_slot: 0 }, 'yearly')).toBe(46800 + 12000 + 2 * 10800)
    })

    it('brings a yearly plan back to one month', () => {
        expect(perMonthCents({ credit_pack: 0, linkedin_slot: 0, whatsapp_slot: 0 }, 'yearly')).toBe(3900)
        expect(perMonthCents({ credit_pack: 1, linkedin_slot: 0, whatsapp_slot: 0 }, 'monthly')).toBe(5900)
    })

    it('rounds the yearly saving to a whole percentage', () => {
        expect(yearlyDiscountPercent()).toBe(20)
    })
})

describe('the arms of the price test', () => {
    it('prices the base plan per arm and leaves the add-ons alone', () => {
        expect(basePriceCents('49')).toBe(4900)
        expect(basePriceCents('29')).toBe(2900)
        expect(planPriceCents({ credit_pack: 1, linkedin_slot: 0, whatsapp_slot: 0 }, 'monthly', '29')).toBe(2900 + 1000)
        expect(planPriceCents({ credit_pack: 1, linkedin_slot: 0, whatsapp_slot: 0 }, 'yearly', '29')).toBe(27600 + 12000)
    })

    it('brings the yearly plan of the $29 arm back to $23 a month', () => {
        expect(basePriceCents('29', 'yearly')).toBe(27600)
        expect(perMonthCents({ credit_pack: 0, linkedin_slot: 0, whatsapp_slot: 0 }, 'yearly', '29')).toBe(2300)
    })

    it('prices at the list price whoever passes no arm', () => {
        expect(planPriceCents({ credit_pack: 0, linkedin_slot: 0, whatsapp_slot: 0 }, 'monthly')).toBe(4900)
    })

    it('reads a missing or unknown arm as the default price, not the list price', () => {
        expect(parsePriceArm('29')).toBe('29')
        expect(parsePriceArm('49')).toBe('49')
        expect(parsePriceArm(null)).toBe('29')
        expect(parsePriceArm('39')).toBe('29')
        expect(basePriceCents(parsePriceArm(null))).toBe(2900)
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
    it('is true only for a workspace on the lifetime plan', () => {
        expect(isLifetimePlan({ plan: 'lifetime' })).toBe(true)
        expect(isLifetimePlan({ plan: BASE_PLAN_SLUG })).toBe(false)
        expect(isLifetimePlan({ plan: null })).toBe(false)
        expect(isLifetimePlan(null)).toBe(false)
    })
})

describe('planDiscountCents', () => {
    const legacy = { interval: 'monthly' as const, monthlyDiscountCents: 2500 }

    it('keeps a legacy base price or a permanent promo on the same interval', () => {
        expect(planDiscountCents(legacy, 'monthly')).toBe(2500)
        expect(planPriceCents({ credit_pack: 1, linkedin_slot: 0, whatsapp_slot: 0 }, 'monthly') - planDiscountCents(legacy, 'monthly')).toBe(3400)
    })

    it('promises nothing past a change of interval', () => {
        expect(planDiscountCents(legacy, 'yearly')).toBe(0)
    })
})
