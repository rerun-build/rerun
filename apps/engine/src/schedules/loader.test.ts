import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-schedule-loader-'))
process.env.RERUN_API_KEY = ''

const sent = vi.hoisted(() => [] as unknown[])

vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (payload: unknown) => {
        sent.push(payload)
        return { delivered: true }
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, readdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { agentDir, scheduleFile, schedulesDir } = await import('../config/paths.js')
const { clearScheduleModel, deleteFiredOneOff, deleteSchedule, listSchedules, markFired, readSchedule, scheduleExists, setScheduleEnabled, updateScheduleAt, writeSchedule } = await import('./loader.js')

const id = 'scheduler'

async function rawSchedule(slug: string, frontmatter: string, body = 'Do the thing.') {
    await mkdir(schedulesDir(id), { recursive: true })
    await writeFile(scheduleFile(id, slug), `---\n${frontmatter}\n---\n\n${body}\n`)
}

beforeEach(async () => {
    sent.length = 0
    await rm(agentDir(id), { recursive: true, force: true })
})

describe('reading a schedule file', () => {
    it('fills every field a sparse file leaves out', async () => {
        await rawSchedule('bare', 'cron: 0 9 * * *')
        expect(await readSchedule(id, 'bare')).toEqual({
            slug: 'bare',
            name: 'bare',
            description: '',
            enabled: true,
            cron: '0 9 * * *',
            runAt: null,
            timezone: null,
            lastRunAt: null,
            connectionId: null,
            provider: null,
            model: null,
            body: 'Do the thing.',
            createdAt: '',
        })
    })

    it('stays enabled unless enabled is literally false', async () => {
        await rawSchedule('off', 'enabled: false')
        await rawSchedule('string-false', "enabled: 'false'")
        await rawSchedule('zero', 'enabled: 0')
        await rawSchedule('nulled', 'enabled: null')
        expect((await readSchedule(id, 'off')).enabled).toBe(false)
        expect((await readSchedule(id, 'string-false')).enabled).toBe(true)
        expect((await readSchedule(id, 'zero')).enabled).toBe(true)
        expect((await readSchedule(id, 'nulled')).enabled).toBe(true)
    })

    it('reads empty strings as null and drops a provider it does not know', async () => {
        await rawSchedule('empties', "cron: ''\nrunAt: ''\ntimezone: ''\nlastRunAt: ''\nconnection: ''\nmodel: ''\nprovider: mistral")
        expect(await readSchedule(id, 'empties')).toMatchObject({ cron: null, runAt: null, timezone: null, lastRunAt: null, connectionId: null, provider: null, model: null })
    })

    it('reads a known provider and a non-string name falls back to the slug', async () => {
        await rawSchedule('typed', 'name: 12\ndescription: 3\nprovider: claude\nconnection: cnx1\nmodel: opus')
        expect(await readSchedule(id, 'typed')).toMatchObject({ name: 'typed', description: '', provider: 'claude', connectionId: 'cnx1', model: 'opus' })
    })

    it('lists only the markdown files, skipping directories and other files', async () => {
        await rawSchedule('daily', 'name: Daily')
        await writeFile(resolve(schedulesDir(id), 'notes.txt'), 'x')
        await mkdir(resolve(schedulesDir(id), 'folder.md'), { recursive: true })
        expect((await listSchedules(id)).map(s => s.slug)).toEqual(['daily'])
    })

    it('lists nothing for an agent without a schedules folder', async () => {
        expect(await listSchedules(id)).toEqual([])
    })
})

describe('writeSchedule', () => {
    it('creates at the slug of its name and notifies the hub once', async () => {
        const created = await writeSchedule(id, { name: 'Daily Report', body: '  Report.  ', cron: '0 9 * * *', timezone: 'Europe/Paris' })
        expect(created).toMatchObject({ slug: 'daily-report', enabled: true, description: '', runAt: null, lastRunAt: null, connectionId: null, provider: null, model: null, body: '  Report.  ' })
        expect(created.createdAt).not.toBe('')
        expect(await readSchedule(id, 'daily-report')).toEqual({ ...created, body: 'Report.' })
        expect(sent).toEqual([{ event: 'agent.schedule.created', kind: 'info', agentId: id, message: 'Daily Report', metadata: { scheduleSlug: 'daily-report' } }])

        await writeSchedule(id, { name: 'Daily Report', body: 'Report again.' })
        expect(sent).toHaveLength(1)
    })

    it('tells the hub which member asked for the schedule', async () => {
        await writeSchedule(id, { name: 'Daily Report', body: 'Report.', cron: '0 9 * * *' }, { id: 'u1', name: 'Marie' })
        expect(sent).toEqual([expect.objectContaining({ event: 'agent.schedule.created', metadata: { scheduleSlug: 'daily-report', authorId: 'u1' } })])
    })

    it('keeps what an update leaves out, including lastRunAt and createdAt', async () => {
        const created = await writeSchedule(id, {
            name: 'Daily',
            description: 'Morning digest',
            body: 'v1',
            cron: '0 9 * * *',
            timezone: 'Europe/Paris',
            enabled: false,
            connectionId: 'cnx1',
            provider: 'claude',
            model: 'opus',
        })
        await markFired(id, 'daily', '2026-09-29T09:00:00.000Z')

        const updated = await writeSchedule(id, { name: 'Daily', body: 'v2' })
        expect(updated).toEqual({ ...created, body: 'v2', lastRunAt: '2026-09-29T09:00:00.000Z' })
    })

    it('clears the pair on an explicit null, where undefined keeps it', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'v1', cron: '0 9 * * *', connectionId: 'cnx1', provider: 'claude', model: 'opus' })

        const kept = await writeSchedule(id, { name: 'Daily', body: 'v2', connectionId: undefined, provider: undefined, model: undefined })
        expect(kept).toMatchObject({ connectionId: 'cnx1', provider: 'claude', model: 'opus' })

        const cleared = await writeSchedule(id, { name: 'Daily', body: 'v3', connectionId: null, provider: null, model: null })
        expect(cleared).toMatchObject({ connectionId: null, provider: null, model: null })
        expect(await readSchedule(id, 'daily')).toMatchObject({ connectionId: null, provider: null, model: null })
    })

    // Looks wrong: cron/runAt coalesce, so a one-off switched to a cron keeps its runAt, which wins in isDue.
    it('cannot clear cron, runAt or timezone with null, since those coalesce', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'v1', runAt: '2026-10-01T00:00:00.000Z', timezone: 'Europe/Paris' })
        const updated = await writeSchedule(id, { name: 'Daily', body: 'v2', cron: '0 9 * * *', runAt: null, timezone: null })
        expect(updated).toMatchObject({ cron: '0 9 * * *', timezone: 'Europe/Paris', runAt: '2026-10-01T00:00:00.000Z' })
    })

    it('refuses a name whose slug is not a single path segment', async () => {
        await expect(writeSchedule(id, { name: '!!!', body: 'x' })).rejects.toMatchObject({ status: 400 })
        expect(sent).toEqual([])
    })
})

describe('updating a schedule in place', () => {
    it('disables a one-off once it fired, but not a cron', async () => {
        await writeSchedule(id, { name: 'Once', body: 'x', runAt: '2026-10-01T00:00:00.000Z' })
        await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *' })

        await markFired(id, 'once', '2026-10-01T00:00:01.000Z')
        await markFired(id, 'daily', '2026-10-01T09:00:00.000Z')

        expect(await readSchedule(id, 'once')).toMatchObject({ enabled: false, lastRunAt: '2026-10-01T00:00:01.000Z' })
        expect(await readSchedule(id, 'daily')).toMatchObject({ enabled: true, lastRunAt: '2026-10-01T09:00:00.000Z' })
    })

    it('toggles enabled and moves the baseline only when one is given', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *' })
        await markFired(id, 'daily', '2026-09-01T09:00:00.000Z')

        await setScheduleEnabled(id, 'daily', false)
        expect(await readSchedule(id, 'daily')).toMatchObject({ enabled: false, lastRunAt: '2026-09-01T09:00:00.000Z' })

        await setScheduleEnabled(id, 'daily', true, '2026-09-30T12:00:00.000Z')
        expect(await readSchedule(id, 'daily')).toMatchObject({ enabled: true, lastRunAt: '2026-09-30T12:00:00.000Z' })
    })

    it('writes at the file slug even after a rename', async () => {
        await rawSchedule('old-slug', 'name: Renamed\ncron: 0 9 * * *')
        await setScheduleEnabled(id, 'old-slug', false)
        expect(scheduleExists(id, 'renamed')).toBe(false)
        expect(await readSchedule(id, 'old-slug')).toMatchObject({ name: 'Renamed', enabled: false })
    })

    it('patches the file at its own slug, the name included', async () => {
        await rawSchedule('old-slug', 'name: Renamed\ncron: 0 9 * * *\nconnection: cnx1')
        expect(await updateScheduleAt(id, 'old-slug', { name: 'Renamed again', enabled: false, body: undefined })).toMatchObject({ slug: 'old-slug', name: 'Renamed again', enabled: false, body: 'Do the thing.', connectionId: 'cnx1' })
        expect(await readdir(schedulesDir(id))).toEqual(['old-slug.md'])
        expect(sent).toEqual([])
    })

    it('clears the pair back to following the agent', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *', connectionId: 'cnx1', provider: 'codex', model: 'gpt' })
        await clearScheduleModel(id, 'daily')
        expect(await readSchedule(id, 'daily')).toMatchObject({ connectionId: null, provider: null, model: null, cron: '0 9 * * *' })
    })

    it('does nothing for a slug that does not exist', async () => {
        await markFired(id, 'ghost', '2026-10-01T00:00:00.000Z')
        await setScheduleEnabled(id, 'ghost', true)
        await clearScheduleModel(id, 'ghost')
        expect(scheduleExists(id, 'ghost')).toBe(false)
        expect(await listSchedules(id)).toEqual([])
    })

    it('deletes a one-off the scheduler stamped, and only that one', async () => {
        const firedAt = '2026-10-01T00:00:01.000Z'
        const once = await writeSchedule(id, { name: 'Once', body: 'x', runAt: '2026-10-01T00:00:00.000Z' })
        const daily = await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *' })
        await markFired(id, 'once', firedAt)
        await markFired(id, 'daily', firedAt)

        expect(await deleteFiredOneOff(id, daily, firedAt)).toBe(false)
        expect(await deleteFiredOneOff(id, once, '2026-10-01T00:00:02.000Z')).toBe(false)
        expect(await deleteFiredOneOff(id, once, firedAt)).toBe(true)

        expect(scheduleExists(id, 'once')).toBe(false)
        expect(scheduleExists(id, 'daily')).toBe(true)
        expect(await deleteFiredOneOff(id, once, firedAt)).toBe(false)
    })

    it('keeps a one-off edited while its run was going, even left switched off', async () => {
        const firedAt = '2026-10-01T00:00:01.000Z'
        const fired = await Promise.all(['Redated', 'Rewritten', 'Rearmed', 'Now a cron'].map(name => writeSchedule(id, { name, body: 'x', runAt: '2026-10-01T00:00:00.000Z' })))
        for (const { slug } of fired) await markFired(id, slug, firedAt)

        await updateScheduleAt(id, 'redated', { runAt: '2026-10-02T00:00:00.000Z', enabled: false })
        await updateScheduleAt(id, 'rewritten', { body: 'y', enabled: false })
        await updateScheduleAt(id, 'rearmed', { enabled: true })
        await updateScheduleAt(id, 'now-a-cron', { cron: '0 9 * * *' })

        for (const schedule of fired) expect(await deleteFiredOneOff(id, schedule, firedAt)).toBe(false)
        expect(await listSchedules(id)).toHaveLength(4)
    })

    it('deletes, and deleting twice is fine', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *' })
        await deleteSchedule(id, 'daily')
        await deleteSchedule(id, 'daily')
        expect(scheduleExists(id, 'daily')).toBe(false)
    })
})

describe('slug safety', () => {
    it('refuses a slug that climbs out of the schedules folder', async () => {
        expect(() => scheduleExists(id, '../x')).toThrow(expect.objectContaining({ status: 400 }))
        await expect(readSchedule(id, '../x')).rejects.toMatchObject({ status: 400 })
        await expect(markFired(id, '../x', 'now')).rejects.toMatchObject({ status: 400 })
        await expect(deleteSchedule(id, '..')).rejects.toMatchObject({ status: 400 })
    })

    it('serializes a round trip that parses back to the same file', async () => {
        await writeSchedule(id, { name: 'Daily', description: 'Has: a colon', body: 'Line 1\n\nLine 2', cron: '*/5 * * * *' })
        const raw = await readFile(scheduleFile(id, 'daily'), 'utf8')
        expect(raw).toContain("cron: '*/5 * * * *'")
        expect((await readSchedule(id, 'daily')).description).toBe('Has: a colon')
    })
})

// The scheduler marks a schedule fired while the agent may be rewriting it: a read landing in the
// middle of a write used to see an empty file and write back a schedule with no cron and no body.
describe('concurrent writes', () => {
    it('keeps the cron, the body and the last edit while the schedule is marked fired', async () => {
        const created = await writeSchedule(id, { name: 'Daily', body: 'Old.', cron: '0 9 * * *' })
        await Promise.all([
            ...Array.from({ length: 10 }, () => markFired(id, 'daily', '2026-10-16T09:00:00.000Z')),
            writeSchedule(id, { name: 'Daily', body: 'New.' }),
            ...Array.from({ length: 10 }, () => setScheduleEnabled(id, 'daily', true)),
        ])

        const after = await readSchedule(id, 'daily')
        expect(after).toMatchObject({ cron: '0 9 * * *', body: 'New.', lastRunAt: '2026-10-16T09:00:00.000Z', createdAt: created.createdAt })
        expect((await readdir(schedulesDir(id))).filter(name => name.endsWith('.tmp'))).toEqual([])
    })

    it('refuses to rewrite a file that has no front matter', async () => {
        await writeSchedule(id, { name: 'Daily', body: 'x', cron: '0 9 * * *' })
        await writeFile(scheduleFile(id, 'daily'), '')
        await expect(markFired(id, 'daily', '2026-10-16T09:00:00.000Z')).rejects.toThrow(/front matter/)
        expect(await readFile(scheduleFile(id, 'daily'), 'utf8')).toBe('')
    })
})
