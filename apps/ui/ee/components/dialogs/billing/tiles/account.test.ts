import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { daysLeft, LOW_CREDITS, planBadge, planBillCents, tilesAccountState, yearlySavingsCents } from './account'

const ACTIVE = { status: 'active', cancelAtPeriodEnd: false, interval: 'monthly', pendingSwitch: null } as const
const PLENTY = 1_000 * MICROS_PER_CREDIT

describe('tilesAccountState', () => {
    it('puts a declined payment before everything else', () => {
        expect(tilesAccountState({ ...ACTIVE, status: 'past_due', cancelAtPeriodEnd: true }, 0)).toBe('past_due')
    })

    it('reads a plan ending at the period end, trial included', () => {
        expect(tilesAccountState({ ...ACTIVE, cancelAtPeriodEnd: true }, PLENTY)).toBe('canceling')
        expect(tilesAccountState({ ...ACTIVE, status: 'trialing', cancelAtPeriodEnd: true }, PLENTY)).toBe('canceling')
    })

    it('keeps a trial a trial, even short of credits', () => {
        expect(tilesAccountState({ ...ACTIVE, status: 'trialing' }, 0)).toBe('trial')
    })

    it('warns under the low credit line, not on it', () => {
        expect(tilesAccountState(ACTIVE, (LOW_CREDITS - 1) * MICROS_PER_CREDIT)).toBe('low')
        expect(tilesAccountState(ACTIVE, LOW_CREDITS * MICROS_PER_CREDIT)).toBe('active')
    })

    it('says nothing of the credits while they load', () => {
        expect(tilesAccountState({ ...ACTIVE, interval: 'yearly' }, null)).toBe('yearly')
    })
})

describe('planBadge', () => {
    it('names the billing of a plan that runs on', () => {
        expect(planBadge(ACTIVE)).toEqual({ kind: 'monthly', tone: 'green' })
        expect(planBadge({ ...ACTIVE, interval: 'yearly' })).toEqual({ kind: 'yearly', tone: 'green' })
    })

    it('shows a switch to monthly waiting for the renewal', () => {
        expect(planBadge({ ...ACTIVE, interval: 'yearly', pendingSwitch: { selection: { quantities: { linkedin_slot: 0, whatsapp_slot: 0 }, interval: 'monthly' }, at: '2027-01-01' } })).toEqual({ kind: 'monthlyFrom', tone: 'yellow' })
    })
})

describe('planBillCents', () => {
    const quantities = { linkedin_slot: 1, whatsapp_slot: 0 }

    it('bills the base plan plus its slots', () => {
        expect(planBillCents({ interval: 'monthly', monthlyDiscountCents: 0 }, quantities, 'monthly')).toBe(2900 + 900)
    })

    it('brings a workspace still on $49 back up to what it is billed', () => {
        expect(planBillCents({ interval: 'monthly', monthlyDiscountCents: -2000 }, quantities, 'monthly')).toBe(4900 + 900)
    })

    it('keeps a discount only on the interval it was given on', () => {
        expect(planBillCents({ interval: 'monthly', monthlyDiscountCents: 500 }, quantities, 'monthly')).toBe(3300)
        expect(planBillCents({ interval: 'monthly', monthlyDiscountCents: 500 }, quantities, 'yearly')).toBe(27600 + 10800)
    })
})

describe('yearlySavingsCents', () => {
    it('is twelve months of the base plan less a year of it', () => {
        expect(yearlySavingsCents()).toBe(7200)
    })
})

describe('daysLeft', () => {
    it('rounds a part of a day up and never goes under zero', () => {
        const now = Date.parse('2026-11-26T12:00:00Z')
        expect(daysLeft('2026-11-29T00:00:00Z', now)).toBe(3)
        expect(daysLeft('2026-11-20T00:00:00Z', now)).toBe(0)
    })
})
