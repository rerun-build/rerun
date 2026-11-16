import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-wake-state-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { DAILY_CAP, EMPTY_WAKE_STATE, MAX_PLANNED, dueWake, isQuiet, markWake, mandatoryWakeAt, outOfQuietHours, placeWake, planWake, readWakeState, rebaseWakesAfterRestore, updateWakeState, wakesToday } = await import('./wake-state.js')

const state = (over: Partial<typeof EMPTY_WAKE_STATE> = {}) => ({ ...EMPTY_WAKE_STATE, planned: [], log: [], ...over })
const MIN = 60_000

beforeAll(async () => {
    await migrate()
    await ensureForeman()
})

describe('quiet hours', () => {
    it("reads the member's night in their own time zone", () => {
        const at = new Date('2026-11-16T21:30:00Z')
        expect(isQuiet(at, 'Europe/Paris')).toBe(true)
        expect(isQuiet(at, 'America/Los_Angeles')).toBe(false)
        expect(isQuiet(at, null)).toBe(true)
        expect(isQuiet(new Date('2026-11-16T10:00:00Z'), 'Europe/Paris')).toBe(false)
    })

    it('moves a moment of the night to eight in the morning, where they live', () => {
        expect(outOfQuietHours(new Date('2026-11-16T21:30:00Z'), 'Europe/Paris').toISOString()).toBe('2026-11-17T07:00:00.000Z')
        expect(outOfQuietHours(new Date('2026-11-16T10:07:00Z'), 'Europe/Paris').toISOString()).toBe('2026-11-16T10:07:00.000Z')
    })
})

describe('placeWake', () => {
    const now = new Date('2026-11-16T10:00:00Z')

    it('never lands sooner than fifteen minutes nor later than a week', () => {
        expect(placeWake(new Date(now.getTime() + 2 * MIN), now, 'UTC')).toEqual({ at: new Date(now.getTime() + 15 * MIN), moved: ['too_soon'] })
        const far = placeWake(new Date('2026-12-30T10:00:00Z'), now, 'UTC')
        expect(far.at.toISOString()).toBe('2026-11-23T10:00:00.000Z')
        expect(far.moved).toEqual(['too_far'])
    })

    it("never lands in the member's night, and says so", () => {
        const night = placeWake(new Date('2026-11-16T23:00:00Z'), now, 'Europe/Paris')
        expect(night.at.toISOString()).toBe('2026-11-17T07:00:00.000Z')
        expect(night.moved).toEqual(['quiet_hours'])
    })
})

describe('dueWake', () => {
    const now = new Date('2026-11-16T10:00:00Z')

    it('wakes for the earliest planned wake that came', () => {
        const s = state({ last: '2026-11-16T09:00:00Z', planned: [{ id: 'b', at: '2026-11-16T09:50:00Z', reason: 'later' }, { id: 'a', at: '2026-11-16T09:40:00Z', reason: 'first' }, { id: 'c', at: '2026-11-16T12:00:00Z', reason: 'not yet' }] })
        expect(dueWake(s, now)).toEqual({ reason: 'first', plannedId: 'a' })
    })

    it('wakes a day after the last wake when nothing is planned, and only then', () => {
        expect(dueWake(state({ last: '2026-11-15T12:00:00Z' }), now)).toBeNull()
        expect(dueWake(state({ last: '2026-11-15T09:00:00Z' }), now)?.reason).toContain('daily check-in')
        expect(mandatoryWakeAt(state({ last: '2026-11-15T09:00:00Z' }), now).toISOString()).toBe('2026-11-16T09:00:00.000Z')
    })

    // A box asleep for three days owes one wake, not three.
    it('catches up once after the box was down', () => {
        const s = state({ last: '2026-11-13T09:00:00Z' })
        const due = dueWake(s, now)
        expect(due).not.toBeNull()
        markWake(s, due!, now)
        expect(dueWake(s, now)).toBeNull()
    })
})

describe('the day', () => {
    it('counts the wakes of the day in the member calendar', () => {
        const s = state({ timezone: 'Europe/Paris' })
        markWake(s, { reason: 'x' }, new Date('2026-11-16T22:30:00Z'))
        expect(wakesToday(s, new Date('2026-11-16T22:59:00Z'))).toBe(1)
        // Still the 16th in UTC, already the 17th in Paris: a new day for the member.
        expect(wakesToday(s, new Date('2026-11-16T23:01:00Z'))).toBe(0)
        expect(DAILY_CAP).toBe(12)
    })

    it('spends a planned wake once it started', () => {
        const s = state({ planned: [{ id: 'a', at: '2026-11-16T09:00:00Z', reason: 'x' }] })
        markWake(s, { reason: 'x', plannedId: 'a' }, new Date('2026-11-16T10:00:00Z'))
        expect(s.planned).toEqual([])
    })
})

describe('planWake', () => {
    it(`keeps at most ${MAX_PLANNED} wakes planned`, () => {
        const s = state()
        const now = new Date('2026-11-16T10:00:00Z')
        for (let i = 0; i < MAX_PLANNED; i++) expect(planWake(s, new Date(now.getTime() + (i + 1) * 60 * MIN), 'x', now)).toHaveProperty('wake')
        expect(planWake(s, new Date(now.getTime() + 10 * 60 * MIN), 'x', now)).toHaveProperty('error')
    })
})

describe('storage', () => {
    it('keeps the state in the foreman system_meta and survives a read', async () => {
        await updateWakeState(s => {
            s.planned = [{ id: 'kept', at: '2099-01-01T09:00:00Z', reason: 'future' }, { id: 'stale', at: '2020-01-01T09:00:00Z', reason: 'past' }]
            s.retryAt = '2099-01-01T00:00:00Z'
        })
        expect((await readWakeState()).planned).toHaveLength(2)
        const now = new Date('2026-11-16T10:00:00Z')
        expect(await rebaseWakesAfterRestore(now)).toEqual({ dropped: 1 })
        const restored = await readWakeState()
        expect(restored.planned.map(wake => wake.id)).toEqual(['kept'])
        expect(restored.last).toBe(now.toISOString())
        expect(restored.retryAt).toBeNull()
    })
})
