import { describe, expect, it } from 'vitest'
import { hasPeriodAdvanced, rerunPeriodUpdate } from './period'

const STORED_FROM_POSTGREST = '2026-09-19T02:29:39+00:00'
const INCOMING_FROM_STRIPE = '2026-09-19T02:29:39.000Z'

describe('hasPeriodAdvanced', () => {
    it('does not advance when the two ISO renderings describe the same instant', () => {
        expect(Date.parse(STORED_FROM_POSTGREST)).toBe(Date.parse(INCOMING_FROM_STRIPE))
        expect(INCOMING_FROM_STRIPE > STORED_FROM_POSTGREST).toBe(true)
        expect(hasPeriodAdvanced(STORED_FROM_POSTGREST, INCOMING_FROM_STRIPE)).toBe(false)
    })

    it('advances on a real renewal', () => {
        expect(hasPeriodAdvanced(STORED_FROM_POSTGREST, '2026-10-19T02:29:39.000Z')).toBe(true)
    })

    it('does not advance on a webhook carrying an older period end', () => {
        expect(hasPeriodAdvanced('2026-10-19T02:29:39+00:00', INCOMING_FROM_STRIPE)).toBe(false)
    })

    it('advances on the first sync, when the workspace holds no period end yet', () => {
        expect(hasPeriodAdvanced(null, INCOMING_FROM_STRIPE)).toBe(true)
        expect(hasPeriodAdvanced(undefined, INCOMING_FROM_STRIPE)).toBe(true)
    })

    it('never advances without an incoming period end', () => {
        expect(hasPeriodAdvanced(STORED_FROM_POSTGREST, null)).toBe(false)
        expect(hasPeriodAdvanced(null, null)).toBe(false)
        expect(hasPeriodAdvanced(STORED_FROM_POSTGREST, 'not a date')).toBe(false)
    })

    it('fails closed on an unreadable stored period end', () => {
        expect(hasPeriodAdvanced('not a date', INCOMING_FROM_STRIPE)).toBe(false)
    })
})

describe('rerunPeriodUpdate', () => {
    const now = '2026-09-14T10:00:00.000Z'

    it('writes nothing at all when the period did not move', () => {
        const update = rerunPeriodUpdate(false, 'active', now)
        expect(update).toEqual({})
        expect('rerun_used_micros' in update).toBe(false)
        expect('rerun_period_anchor' in update).toBe(false)
    })

    it('refills the credit when a live subscription renewed', () => {
        expect(rerunPeriodUpdate(true, 'active', now)).toEqual({ rerun_used_micros: 0, rerun_period_anchor: now })
    })

    it('never refills a trial, only re-anchors it', () => {
        const update = rerunPeriodUpdate(true, 'trialing', now)
        expect(update).toEqual({ rerun_period_anchor: now })
        expect('rerun_used_micros' in update).toBe(false)
    })

    it('still refills a past_due subscription, which keeps its allowance while Stripe retries', () => {
        expect(rerunPeriodUpdate(true, 'past_due', now)).toEqual({ rerun_used_micros: 0, rerun_period_anchor: now })
    })
})
