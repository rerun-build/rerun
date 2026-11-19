import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-schedule-race-'))
process.env.RERUN_API_KEY = ''

// A one-off deletes itself once its run is done, so its file can go between the `readdir` of a
// listing and the read of that file: the listing must skip it, not throw.
vi.mock('node:fs/promises', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs/promises')>()
    const readFile = (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
        if (String(path).endsWith('gone-mid-listing.md')) await actual.rm(path as string, { force: true })
        return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest)
    }) as typeof actual.readFile
    return { ...actual, default: { ...actual, readFile }, readFile }
})

const { describe, expect, it } = await import('vitest')
const { listSchedules, writeSchedule } = await import('./loader.js')

describe('listing schedules while one deletes itself', () => {
    it('skips the file that went between the directory read and its own read', async () => {
        await writeSchedule('racer', { name: 'Gone mid listing', body: 'x', runAt: '2026-10-01T00:00:00.000Z' })
        await writeSchedule('racer', { name: 'Daily', body: 'x', cron: '0 9 * * *' })

        expect((await listSchedules('racer')).map(s => s.slug)).toEqual(['daily'])
    })
})
