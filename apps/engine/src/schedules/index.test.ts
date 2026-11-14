import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-schedule-index-'))
process.env.RERUN_API_KEY = ''

vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async () => ({ delivered: true }),
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { buildScheduleIndex } = await import('./index.js')
const { markFired, setScheduleEnabled, writeSchedule } = await import('./loader.js')

afterEach(() => {
    vi.useRealTimers()
})

describe('buildScheduleIndex', () => {
    it('is empty when no schedule is enabled', async () => {
        expect(await buildScheduleIndex('noschedules')).toBe('')
        await writeSchedule('allOff', { name: 'Off', body: 'x', cron: '0 9 * * *', enabled: false })
        expect(await buildScheduleIndex('allOff')).toBe('')
    })

    it('lists cron and one-off schedules by slug, without their next run', async () => {
        vi.useFakeTimers({ now: new Date('2026-09-30T08:00:00.000Z'), toFake: ['Date'] })
        await writeSchedule('routines', { name: 'Daily report', body: 'Report.', cron: '0 9 * * *', timezone: 'UTC' })
        await writeSchedule('routines', { name: 'Launch', body: 'Launch.', runAt: '2026-10-01T12:00:00.000Z' })
        await writeSchedule('routines', { name: 'Done once', body: 'x', runAt: '2026-09-01T12:00:00.000Z' })
        await markFired('routines', 'done-once', '2026-09-01T12:00:00.000Z')
        await writeSchedule('routines', { name: 'Stale once', body: 'x', runAt: '2026-09-02T12:00:00.000Z' })
        await markFired('routines', 'stale-once', '2026-09-02T12:00:00.000Z')
        await setScheduleEnabled('routines', 'stale-once', true)

        const index = await buildScheduleIndex('routines')
        expect(index.startsWith('These routines run on a schedule.')).toBe(true)
        expect(index).toContain('schedule_get')
        expect(index.split('\n').filter(l => l.startsWith('- '))).toEqual(['- Daily report (slug: daily-report): cron 0 9 * * *', '- Launch (slug: launch): once 2026-10-01T12:00:00.000Z', '- Stale once (slug: stale-once): once 2026-09-02T12:00:00.000Z'])
        expect(index).not.toContain(', next ')
        expect(index).not.toContain('Done once')
    })
})
