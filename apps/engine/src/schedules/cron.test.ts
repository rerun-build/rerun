import { describe, expect, it } from 'vitest'
import { isDue, isValidCron, isValidTimezone, nextRunAt } from './cron.js'
import type { Schedule } from './loader.js'

function make(overrides: Partial<Schedule>): Schedule {
    return {
        slug: 'test',
        name: 'Test',
        description: '',
        enabled: true,
        cron: null,
        runAt: null,
        timezone: null,
        lastRunAt: null,
        body: 'do something',
        createdAt: '2026-06-01T00:00:00.000Z',
        ...overrides,
    }
}

describe('isValidCron', () => {
    it('accepts valid expressions', () => {
        expect(isValidCron('0 8 * * *')).toBe(true)
        expect(isValidCron('*/15 * * * *')).toBe(true)
    })
    it('rejects garbage', () => {
        expect(isValidCron('not a cron')).toBe(false)
        expect(isValidCron('99 99 99 99 99')).toBe(false)
    })
})

describe('isDue one-shot', () => {
    it('fires once the runAt time has passed', () => {
        const s = make({ runAt: '2026-06-02T10:00:00.000Z' })
        expect(isDue(s, new Date('2026-06-02T09:59:00.000Z'))).toBe(false)
        expect(isDue(s, new Date('2026-06-02T10:00:30.000Z'))).toBe(true)
    })
    it('does not fire again after it has run', () => {
        const s = make({ runAt: '2026-06-02T10:00:00.000Z', lastRunAt: '2026-06-02T10:00:05.000Z' })
        expect(isDue(s, new Date('2026-06-02T11:00:00.000Z'))).toBe(false)
    })
    it('never fires when disabled', () => {
        const s = make({ runAt: '2026-06-02T10:00:00.000Z', enabled: false })
        expect(isDue(s, new Date('2026-06-02T12:00:00.000Z'))).toBe(false)
    })
})

describe('isDue cron', () => {
    it('is due when the last scheduled time has not been run yet', () => {
        const s = make({ cron: '0 8 * * *', timezone: 'UTC', lastRunAt: '2026-06-01T08:00:00.000Z' })
        expect(isDue(s, new Date('2026-06-02T08:05:00.000Z'))).toBe(true)
    })
    it('is not due when already run for the current slot', () => {
        const s = make({ cron: '0 8 * * *', timezone: 'UTC', lastRunAt: '2026-06-02T08:00:10.000Z' })
        expect(isDue(s, new Date('2026-06-02T08:05:00.000Z'))).toBe(false)
    })
    it('fires on first ever evaluation after a scheduled time', () => {
        const s = make({ cron: '0 8 * * *', timezone: 'UTC' })
        expect(isDue(s, new Date('2026-06-02T08:05:00.000Z'))).toBe(true)
    })
})

describe('nextRunAt', () => {
    it('returns the next cron occurrence', () => {
        const s = make({ cron: '0 8 * * *', timezone: 'UTC' })
        expect(nextRunAt(s, new Date('2026-06-02T09:00:00.000Z'))).toBe('2026-06-03T08:00:00.000Z')
    })
    it('returns null for a spent one-shot', () => {
        const s = make({ runAt: '2026-06-02T10:00:00.000Z', lastRunAt: '2026-06-02T10:00:05.000Z' })
        expect(nextRunAt(s, new Date('2026-06-02T11:00:00.000Z'))).toBe(null)
    })
})

describe('isValidTimezone', () => {
    it('accepts the zones croner can run a schedule in', () => {
        expect(isValidTimezone('Europe/Paris')).toBe(true)
        expect(isValidTimezone('America/New_York')).toBe(true)
        expect(isValidTimezone('UTC')).toBe(true)
    })
    it('rejects names croner cannot convert to', () => {
        expect(isValidTimezone('Eastern')).toBe(false)
        expect(isValidTimezone('Europe/Pariss')).toBe(false)
    })
})

// A schedule whose timing can't be computed (a timezone or cron edited into the file by hand, or
// written before both were checked) must not throw: the scheduler checks every schedule of every
// agent in one tick, and a throw there ends the tick, and the process with it.
describe('a schedule croner cannot compute', () => {
    const now = new Date('2026-06-02T10:00:00.000Z')
    it('is never due and has no next run, with an unknown timezone', () => {
        const s = make({ cron: '0 8 * * *', timezone: 'Eastern' })
        expect(isDue(s, now)).toBe(false)
        expect(nextRunAt(s, now)).toBeNull()
    })
    it('is never due and has no next run, with a cron that does not parse', () => {
        const s = make({ cron: 'every morning' })
        expect(isDue(s, now)).toBe(false)
        expect(nextRunAt(s, now)).toBeNull()
    })
})
