import { describe, expect, it } from 'vitest'
import { armPlanLimitLatch, clearPlanLimitLatch, isPlanLimitLatched, forgetPlanLimits, planLimitWindowsFromClaude, planLimitWindowsFromCodex, planLimitWindowsFromGrok, readPlanLimits, recordPlanLimits } from './plan-limits.js'

describe('planLimitWindowsFromClaude', () => {
    it('reads the session, weekly and per-model windows', () => {
        const windows = planLimitWindowsFromClaude({
            rate_limits: {
                five_hour: { utilization: 42, resets_at: '2026-10-05T15:00:00Z' },
                seven_day: { utilization: 71, resets_at: '2026-10-09T08:00:00Z' },
                seven_day_opus: { utilization: 12, resets_at: null },
                seven_day_sonnet: null,
            },
        })
        expect(windows).toEqual([
            { kind: 'session', label: null, usedPercent: 42, resetsAt: '2026-10-05T15:00:00Z' },
            { kind: 'weekly', label: null, usedPercent: 71, resetsAt: '2026-10-09T08:00:00Z' },
            { kind: 'model', label: 'Opus', usedPercent: 12, resetsAt: null },
        ])
    })

    it('prefers model_scoped over the fixed per-model fields naming the same buckets', () => {
        const windows = planLimitWindowsFromClaude({
            rate_limits: {
                seven_day_opus: { utilization: 12, resets_at: null },
                model_scoped: [{ display_name: 'Fable', utilization: 30, resets_at: '2026-10-09T08:00:00Z' }],
            },
        })
        expect(windows).toEqual([{ kind: 'model', label: 'Fable', usedPercent: 30, resetsAt: '2026-10-09T08:00:00Z' }])
    })

    it('reads nothing off a session where plan limits do not apply', () => {
        expect(planLimitWindowsFromClaude({ rate_limits: null })).toEqual([])
        expect(planLimitWindowsFromClaude(undefined)).toEqual([])
        expect(planLimitWindowsFromClaude({ rate_limits: { five_hour: { utilization: null, resets_at: null } } })).toEqual([])
    })
})

describe('planLimitWindowsFromCodex', () => {
    it('names a window after its duration, whichever slot reports it', () => {
        const weeklyOnly = planLimitWindowsFromCodex({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1791580463 }, secondary: null } })
        expect(weeklyOnly).toEqual([{ kind: 'weekly', label: null, usedPercent: 20, resetsAt: '2026-10-09T21:14:23.000Z' }])

        const both = planLimitWindowsFromCodex({
            rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: null } },
        })
        expect(both.map(w => w.kind)).toEqual(['session', 'weekly'])
    })

    it('falls back on the slot when the duration is missing', () => {
        const windows = planLimitWindowsFromCodex({ rateLimits: { primary: { usedPercent: 5 }, secondary: { usedPercent: 60 } } })
        expect(windows.map(w => w.kind)).toEqual(['session', 'weekly'])
    })

    it('reads nothing off a failed read', () => {
        expect(planLimitWindowsFromCodex(null)).toEqual([])
        expect(planLimitWindowsFromCodex({ rateLimits: null })).toEqual([])
    })
})

describe('plan limits store', () => {
    it('keeps the last reading when a later one comes back empty', () => {
        recordPlanLimits('c1', [{ kind: 'session', label: null, usedPercent: 10, resetsAt: null }])
        recordPlanLimits('c1', [])
        expect(readPlanLimits('c1')?.windows).toHaveLength(1)
        forgetPlanLimits('c1')
        expect(readPlanLimits('c1')).toBeNull()
    })
})

describe('plan limit latch', () => {
    const now = Date.parse('2026-11-04T15:00:00Z')

    it('holds the connection until the spent window resets', () => {
        recordPlanLimits('spent', [{ kind: 'session', label: null, usedPercent: 100, resetsAt: '2026-11-04T18:00:00Z' }])
        armPlanLimitLatch('spent', now)
        expect(isPlanLimitLatched('spent', Date.parse('2026-11-04T17:59:00Z'))).toBe(true)
        expect(isPlanLimitLatched('spent', Date.parse('2026-11-04T18:00:00Z'))).toBe(false)
        expect(isPlanLimitLatched('another', now)).toBe(false)
        clearPlanLimitLatch('spent')
        forgetPlanLimits('spent')
    })

    // Claude reads its usage when a run ends well, so a refused run leaves the reading under 100%.
    it('holds for half an hour when no reading says when the limit resets', () => {
        recordPlanLimits('stale', [{ kind: 'session', label: null, usedPercent: 97, resetsAt: '2026-11-04T18:00:00Z' }])
        armPlanLimitLatch('stale', now)
        expect(isPlanLimitLatched('stale', now + 29 * 60_000)).toBe(true)
        expect(isPlanLimitLatched('stale', now + 30 * 60_000)).toBe(false)

        recordPlanLimits('stale', [{ kind: 'session', label: null, usedPercent: 100, resetsAt: '2026-11-04T14:00:00Z' }])
        armPlanLimitLatch('stale', now)
        expect(isPlanLimitLatched('stale', now + 29 * 60_000)).toBe(true)
        forgetPlanLimits('stale')
    })

    // Codex refreshes its windows during the run's teardown, after the refusal armed the hold.
    it('picks up the reset time a reading records after the hold is armed', () => {
        recordPlanLimits('late', [{ kind: 'weekly', label: null, usedPercent: 97, resetsAt: '2026-11-07T15:00:00Z' }])
        armPlanLimitLatch('late', now)
        recordPlanLimits('late', [{ kind: 'weekly', label: null, usedPercent: 100, resetsAt: '2026-11-07T15:00:00Z' }])
        expect(isPlanLimitLatched('late', now + 31 * 60_000)).toBe(true)
        expect(isPlanLimitLatched('late', Date.parse('2026-11-07T14:59:00Z'))).toBe(true)
        expect(isPlanLimitLatched('late', Date.parse('2026-11-07T15:00:00Z'))).toBe(false)
        clearPlanLimitLatch('late')
        forgetPlanLimits('late')
    })

    it('keeps the probe as the floor when a later reading no longer says spent', () => {
        recordPlanLimits('eased', [{ kind: 'session', label: null, usedPercent: 100, resetsAt: '2026-11-04T18:00:00Z' }])
        armPlanLimitLatch('eased', now)
        recordPlanLimits('eased', [{ kind: 'session', label: null, usedPercent: 40, resetsAt: '2026-11-04T18:00:00Z' }])
        expect(isPlanLimitLatched('eased', now + 29 * 60_000)).toBe(true)
        expect(isPlanLimitLatched('eased', now + 30 * 60_000)).toBe(false)
        clearPlanLimitLatch('eased')
        forgetPlanLimits('eased')
    })

    it('lifts the hold when cleared', () => {
        armPlanLimitLatch('cleared', now)
        clearPlanLimitLatch('cleared')
        expect(isPlanLimitLatched('cleared', now)).toBe(false)
    })
})

// `/billing?format=credits` as the proxy answered a paid Grok account on 2026-11-26, nothing spent yet.
describe('planLimitWindowsFromGrok', () => {
    const period = { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-23T14:53:50.529+00:00', end: '2026-11-30T14:53:50.529+00:00' }
    const answer = (config: Record<string, unknown>) => ({ config: { isUnifiedBillingUser: true, prepaidBalance: { val: 0 }, billingPeriodStart: period.start, billingPeriodEnd: period.end, ...config } })

    it('reads a period with nothing spent as 0%, which the proxy says by leaving the share out', () => {
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: period }))).toEqual([{ kind: 'weekly', label: null, usedPercent: 0, resetsAt: '2026-11-30T14:53:50.529Z' }])
    })

    it('reads the share of the week spent', () => {
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: period, creditUsagePercent: 100 }))[0]).toMatchObject({ kind: 'weekly', usedPercent: 100 })
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: period, creditUsagePercent: 37.5 }))[0]!.usedPercent).toBe(37.5)
    })

    it('names a month, and a period of a type it does not know by its length', () => {
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: { ...period, type: 'USAGE_PERIOD_TYPE_MONTHLY' } }))[0]!.kind).toBe('monthly')
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: { ...period, type: 'USAGE_PERIOD_TYPE_NEW' } }))[0]!.kind).toBe('weekly')
    })

    it('keeps no gauge rather than a wrong one when the shape moved', () => {
        expect(planLimitWindowsFromGrok(null)).toEqual([])
        expect(planLimitWindowsFromGrok({ config: {} })).toEqual([])
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: period, creditUsagePercent: '40%' }))).toEqual([])
        expect(planLimitWindowsFromGrok(answer({ currentPeriod: { type: 'USAGE_PERIOD_TYPE_NEW', start: period.start, end: '2026-11-24T00:00:00Z' } }))).toEqual([])
    })
})
