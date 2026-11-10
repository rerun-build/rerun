import { describe, expect, it } from 'vitest'
import type { PlanLimitWindow } from '@rerun/contracts'
import { isUsable, livePlanWindows, planLimitTone, planWindowName, providerPitch, sourceSummary, tightestPlanWindow, type RerunCredit } from './ai-sources'
import { englishTranslator } from '@/lib/i18n/english-translator'
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
        expect(planWindowName({ ...weekly, kind: 'model', label: 'Opus' }, englishTranslator('connections'))).toBe('Opus weekly')
        expect(planWindowName(session, englishTranslator('connections'))).toBe('Session')
    })

    it("names OpenCode Go's windows the way its plan does", () => {
        expect(planWindowName(session, englishTranslator('connections'), 'opencode')).toBe('5-hour')
        expect(planWindowName({ ...weekly, kind: 'monthly' }, englishTranslator('connections'), 'opencode')).toBe('Monthly')
        expect(planWindowName(weekly, englishTranslator('connections'), 'opencode')).toBe('Weekly')
    })
})

describe('sourceSummary of a plan', () => {
    it('reads the plan windows once there is a reading, the model count before', () => {
        const future = (window: PlanLimitWindow) => ({ ...window, resetsAt: new Date(Date.now() + 3_600_000).toISOString() })
        expect(sourceSummary(plan([future(session), future(weekly), { ...future(weekly), kind: 'model', label: 'Opus' }]), credit, englishTranslator('connections'), 'en')).toBe('Session 42% · Weekly 81%')
        expect(sourceSummary(plan(null), credit, englishTranslator('connections'), 'en')).toBe('Plan · 2 models')
    })
})

describe('sourceSummary of an API key', () => {
    it('names the kind and counts the models in English as before', () => {
        const key = (provider: BoxConnection['provider'], models: string[]): BoxConnection => ({ ...plan(null), provider, models })
        expect(sourceSummary(key('anthropic', ['claude-opus-5-5']), credit, englishTranslator('connections'), 'en')).toBe('API key · 1 model')
        expect(sourceSummary(key('custom', []), credit, englishTranslator('connections'), 'en')).toBe('Custom endpoint · 0 models')
    })

    it('pitches every provider the way the picker always did', () => {
        expect(providerPitch('claude', englishTranslator('connections'))).toEqual({ title: 'Claude Pro or Max', hint: 'Sign in with your Claude account' })
        expect(providerPitch('custom', englishTranslator('connections')).hint).toBe('Ollama, LM Studio, vLLM or any OpenAI-compatible server')
    })
})
