import { describe, expect, it } from 'vitest'
import type { PlanLimitWindow } from '@rerun/contracts'
import { isUsable, livePlanWindows, planLimitTone, planWindowName, sourceSummary, tightestPlanWindow, type RerunCredit } from './ai-sources'
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
