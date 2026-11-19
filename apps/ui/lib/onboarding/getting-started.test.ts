import { describe, expect, it, vi } from 'vitest'

vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

import { doneCount, isComplete, nextStep, NO_PROGRESS, progressOf, rewardOf, stepsOf } from './getting-started'

const trialing = { subscription_status: 'trialing', trial_ends_at: '2026-09-26T12:00:00Z' }
const paid = { subscription_status: 'active', trial_ends_at: null }

describe('progressOf', () => {
    it('reads the five steps and ignores the reward and dismissed rows', () => {
        const progress = progressOf(new Set(['first_agent', 'schedule', 'payment_method', 'reward', 'dismissed']), 'none')
        expect(progress).toEqual({ phone: null, first_agent: true, ai_provider: false, invite: false, schedule: true, payment_method: true })
        expect(doneCount(progress)).toBe(3)
    })

    it('leaves the phone out for an account never asked for one, or not read yet', () => {
        expect(stepsOf(progressOf(new Set(), 'none'))).toHaveLength(5)
        expect(stepsOf(progressOf(new Set(), null))).toHaveLength(5)
    })

    it('puts the phone first for an account that was asked for one', () => {
        const skipped = progressOf(new Set(), 'skipped')
        expect(stepsOf(skipped)).toHaveLength(6)
        expect(nextStep(skipped)?.id).toBe('phone')
        expect(doneCount(progressOf(new Set(), 'verified'))).toBe(1)
    })
})

describe('nextStep', () => {
    it('is the first step not done yet, in list order', () => {
        expect(nextStep({ ...NO_PROGRESS, first_agent: true })?.id).toBe('ai_provider')
    })

    it('waits on the payment method once the first four are done', () => {
        const four = progressOf(new Set(['first_agent', 'ai_provider', 'invite', 'schedule']), 'none')
        expect(isComplete(four)).toBe(false)
        expect(nextStep(four)?.id).toBe('payment_method')
    })

    it('is null once the five are done', () => {
        const all = progressOf(new Set(['first_agent', 'ai_provider', 'invite', 'schedule', 'payment_method']), 'none')
        expect(isComplete(all)).toBe(true)
        expect(nextStep(all)).toBeNull()
    })

    it('waits on a skipped phone once the five are done', () => {
        const five = new Set(['first_agent', 'ai_provider', 'invite', 'schedule', 'payment_method'])
        expect(isComplete(progressOf(five, 'skipped'))).toBe(false)
        expect(isComplete(progressOf(five, 'verified'))).toBe(true)
    })

    it('counts a number no code reaches as the phone done', () => {
        const five = new Set(['first_agent', 'ai_provider', 'invite', 'schedule', 'payment_method'])
        expect(isComplete(progressOf(five, 'unverifiable'))).toBe(true)
        expect(doneCount(progressOf(new Set(), 'unverifiable'))).toBe(1)
    })
})

describe('rewardOf', () => {
    it('offers the days to a running trial', () => {
        expect(rewardOf(new Set(), trialing)).toBe('available')
    })

    it('offers nothing to a paid workspace', () => {
        expect(rewardOf(new Set(['first_agent']), paid)).toBeNull()
    })

    it('keeps the celebration once granted, even after the trial converted', () => {
        expect(rewardOf(new Set(['reward']), paid)).toBe('granted')
    })

    it('offers nothing to a trial without an end date', () => {
        expect(rewardOf(new Set(), { subscription_status: 'trialing', trial_ends_at: null })).toBeNull()
    })
})
