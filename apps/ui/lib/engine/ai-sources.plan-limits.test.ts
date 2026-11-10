import { describe, expect, it } from 'vitest'
import { RERUN_CONNECTION_ID, type PlanLimitWindow } from '@rerun/contracts'
import { isUsable, livePlanWindows, pillUsage, planLimitTone, planWindowName, sourceSummary, tightestPlanWindow, type RerunCredit } from './ai-sources'
import type { BoxConnection } from './types'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')
const session: PlanLimitWindow = { kind: 'session', label: null, usedPercent: 42, resetsAt: '2026-10-05T14:00:00.000Z' }
const weekly: PlanLimitWindow = { kind: 'weekly', label: null, usedPercent: 81, resetsAt: '2026-10-09T08:00:00.000Z' }
const credit: RerunCredit = { usedMicros: 0, budgetMicros: 0, resetAt: null, percent: 0 }

function plan(windows: PlanLimitWindow[] | null): BoxConnection {
    return {
        id: 'c1',
        name: 'Claude',
        provider: 'claude',
        models: ['claude-opus-5-5', 'claude-sonnet-5[1m]'],
        extraModels: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        connected: true,
        credentialRejected: false,
        planLimits: windows && { windows, capturedAt: '2026-10-05T11:55:00.000Z' },
        cliModels: null,
        providerModels: null,
        discoveredModels: null,
    }
}

describe('isUsable', () => {
    it('takes a credential its provider turned away for one that cannot run, token on file or not', () => {
        expect(isUsable(plan(null), credit)).toBe(true)
        expect(isUsable({ ...plan(null), credentialRejected: true }, credit)).toBe(false)
        expect(isUsable({ ...plan(null), connected: false }, credit)).toBe(false)
    })
})

describe('livePlanWindows', () => {
    it('keeps a window whose reset is still ahead', () => {
        expect(livePlanWindows(plan([session, weekly]), NOW)).toEqual([session, weekly])
    })

    it('empties a window whose reset has passed since the reading', () => {
        const stale = { ...session, usedPercent: 97, resetsAt: '2026-10-05T11:59:00.000Z' }
        expect(livePlanWindows(plan([stale, weekly]), NOW)).toEqual([{ ...stale, usedPercent: 0, resetsAt: null }, weekly])
    })

    it('reads no window off a connection with no reading', () => {
        expect(livePlanWindows(plan(null), NOW)).toEqual([])
    })
})

describe('tightestPlanWindow', () => {
    it('picks the window closest to running out', () => {
        expect(tightestPlanWindow([session, weekly])).toBe(weekly)
        expect(tightestPlanWindow([])).toBeNull()
    })
})

describe('planLimitTone', () => {
    it('warns from 75% and alarms from 90%', () => {
        expect([0, 74, 75, 89, 90, 100].map(planLimitTone)).toEqual(['brand', 'brand', 'warning', 'warning', 'destructive', 'destructive'])
    })
})

describe('planWindowName', () => {
    it('names a per-model window after its model', () => {
        expect(planWindowName({ ...weekly, kind: 'model', label: 'Opus' })).toBe('Opus weekly')
        expect(planWindowName(session)).toBe('Session')
    })

    it("names OpenCode Go's windows the way its plan does", () => {
        expect(planWindowName(session, 'opencode')).toBe('5-hour')
        expect(planWindowName({ ...weekly, kind: 'monthly' }, 'opencode')).toBe('Monthly')
        expect(planWindowName(weekly, 'opencode')).toBe('Weekly')
    })
})

describe('sourceSummary of a plan', () => {
    it('reads the plan windows once there is a reading, the model count before', () => {
        const future = (window: PlanLimitWindow) => ({ ...window, resetsAt: new Date(Date.now() + 3_600_000).toISOString() })
        expect(sourceSummary(plan([future(session), future(weekly), { ...future(weekly), kind: 'model', label: 'Opus' }]), credit)).toBe('Session 42% · Weekly 81%')
        expect(sourceSummary(plan(null), credit)).toBe('Plan · 2 models')
    })
})

describe('pillUsage', () => {
    const claude = (planWindows: PlanLimitWindow[]) => ({ connectionId: 'c1', provider: 'claude', planWindows })
    const monthly: PlanLimitWindow = { kind: 'monthly', label: null, usedPercent: 93, resetsAt: null }
    const opus: PlanLimitWindow = { kind: 'model', label: 'Opus', usedPercent: 88, resetsAt: null }
    const rerun = { connectionId: RERUN_CONNECTION_ID, provider: 'rerun', planWindows: [] }

    it('puts the session inside and the weekly window outside', () => {
        expect(pillUsage(claude([session, weekly]), credit)).toEqual({ inner: 42, outer: 81, summary: 'Session 42% used, Weekly 81% used' })
    })

    it('rings the outside with the longer window that runs out first', () => {
        expect(pillUsage(claude([session, weekly, opus]), credit)?.outer).toBe(88)
        expect(pillUsage({ connectionId: 'c2', provider: 'opencode', planWindows: [session, weekly, monthly] }, credit)?.outer).toBe(93)
    })

    it('fills a single ring when the plan has one window', () => {
        expect(pillUsage(claude([session]), credit)).toEqual({ inner: 42, outer: null, summary: 'Session 42% used' })
        expect(pillUsage({ connectionId: 'c3', provider: 'codex', planWindows: [weekly] }, credit)).toEqual({ inner: 81, outer: null, summary: 'Weekly 81% used' })
    })

    it('draws nothing without a reading', () => {
        expect(pillUsage(claude([]), credit)).toBeNull()
    })

    it('rings the Rerun credit of the month, unless there is none or it is paused', () => {
        const spending: RerunCredit = { usedMicros: 840_000, budgetMicros: 2_000_000, resetAt: null, percent: 42 }
        expect(pillUsage(rerun, spending)).toEqual({ inner: 42, outer: null, summary: 'Monthly credits 42% used' })
        expect(pillUsage(rerun, credit)).toBeNull()
        expect(pillUsage(rerun, { ...spending, paused: true })).toBeNull()
    })
})
