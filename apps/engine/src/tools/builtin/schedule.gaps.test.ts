import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-schedule-gaps-'))
process.env.RERUN_API_KEY = ''

const { afterAll, beforeAll, describe, expect, it, vi } = await import('vitest')

vi.mock('../../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../runtime/notify.js')>()),
    sendNotification: async () => ({ delivered: true }),
}))

const { DEFAULT_CONNECTION_MODELS } = await import('@rerun/contracts')
const { createConnection } = await import('../../connections/store.js')
const { scheduleTools } = await import('./schedule.js')
const { listSchedules, readSchedule, scheduleExists, writeSchedule } = await import('../../schedules/loader.js')
const { scheduleFile, schedulesDir } = await import('../../config/paths.js')

let agentCount = 0

function freshAgent() {
    const id = `sched-${++agentCount}`
    const tools = scheduleTools({ agent: { id, config: { kind: 'user' }, resolved: { connection: { id: 'cnx-openai' }, provider: 'openai', model: 'gpt-5' } }, provider: 'openai', model: 'gpt-5' } as any)
    const run = async (name: string, args: Record<string, unknown>) => (await (tools[name] as any).execute(args, {} as any)) as string
    return { id, run }
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T06:00:00.000Z'))
})

afterAll(() => {
    vi.useRealTimers()
})

describe('schedule_list', () => {
    it('says so when there is nothing scheduled', async () => {
        expect(await freshAgent().run('schedule_list', {})).toBe('No scheduled tasks yet.')
    })

    it('shows recurring, one-shot and disabled tasks with their next run', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Morning digest', body: 'digest', cron: '*/15 * * * *' })
        await writeSchedule(id, { name: 'Call the bank', body: 'call', runAt: '2026-10-02T09:00:00.000Z' })
        await writeSchedule(id, { name: 'Paused sync', body: 'sync', cron: '*/5 * * * *', enabled: false })
        const lines = (await run('schedule_list', {})).split('\n').sort()
        expect(lines).toEqual([
            '- Call the bank (call-the-bank): once 2026-10-02T09:00:00.000Z, next 2026-10-02T09:00:00.000Z',
            '- Morning digest (morning-digest): cron */15 * * * *, next 2026-09-30T06:15:00.000Z',
            '- Paused sync (paused-sync): cron */5 * * * *, disabled',
        ])
    })

    it('shows a one-shot that already fired as never running again', async () => {
        const { id, run } = freshAgent()
        await mkdir(schedulesDir(id), { recursive: true })
        await writeFile(scheduleFile(id, 'fired'), '---\nname: Fired\nrunAt: "2026-09-01T00:00:00.000Z"\nlastRunAt: "2026-09-01T00:00:05.000Z"\n---\nbody\n')
        expect(await run('schedule_list', {})).toBe('- Fired (fired): once 2026-09-01T00:00:00.000Z, next never')
    })
})

describe('schedule_get', () => {
    it('shows a fired one-shot with its last run and model', async () => {
        const { id, run } = freshAgent()
        await mkdir(schedulesDir(id), { recursive: true })
        await writeFile(
            scheduleFile(id, 'reminder'),
            '---\nname: Reminder\nrunAt: "2026-10-01T10:00:00.000Z"\nlastRunAt: "2026-09-29T10:00:00.000Z"\nprovider: claude\nmodel: claude-opus-4-8\n---\nRemind the user.\n',
        )
        expect(await run('schedule_get', { slug: 'reminder' })).toBe(
            ['Reminder (reminder)', 'Runs once at: 2026-10-01T10:00:00.000Z', 'Enabled: true', 'Next run: never', 'Last run: 2026-09-29T10:00:00.000Z', 'Model: claude-opus-4-8 (claude)', 'Remind the user.'].join('\n'),
        )
    })

    it('omits the next run of a disabled task and shows a model without a provider', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Off', body: 'noop', cron: '0 * * * *', enabled: false, model: 'gpt-5' })
        expect(await run('schedule_get', { slug: 'off' })).toBe(['Off (off)', 'Cron: 0 * * * *', 'Enabled: false', 'Model: gpt-5', 'noop'].join('\n'))
    })
})

describe('schedule_create', () => {
    const base = { name: 'Weekly report', description: 'Report every Monday', body: 'Write the report.' }

    it('creates a recurring task that follows the agent when no model is named', async () => {
        const { id, run } = freshAgent()
        expect(await run('schedule_create', { ...base, cron: '0 9 * * 1', timezone: 'Europe/Paris' })).toBe('Created schedule weekly-report')
        expect(await readSchedule(id, 'weekly-report')).toMatchObject({ name: 'Weekly report', description: 'Report every Monday', body: 'Write the report.', cron: '0 9 * * 1', runAt: null, timezone: 'Europe/Paris', enabled: true, connectionId: null, provider: null, model: null })
    })

    it('pins the running connection and provider for a model named without one', async () => {
        const { id, run } = freshAgent()
        await run('schedule_create', { ...base, cron: '0 9 * * 1', model: 'gpt-5-mini' })
        expect(await readSchedule(id, 'weekly-report')).toMatchObject({ connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5-mini' })
    })

    it('refuses a provider nobody plugged into the box and creates nothing', async () => {
        const { id, run } = freshAgent()
        expect(await run('schedule_create', { ...base, cron: '0 9 * * 1', provider: 'google', model: 'gemini-2.5-pro' })).toBe(
            'No google connection is plugged into this box, so a task pinned to gemini-2.5-pro would fall back to your own model. Leave provider and model out so it follows you, or ask the user to connect google first.'
        )
        expect(scheduleExists(id, 'weekly-report')).toBe(false)
    })

    it('drops a provider named without a model', async () => {
        const { id, run } = freshAgent()
        await run('schedule_create', { ...base, cron: '0 9 * * 1', provider: 'claude' })
        expect(await readSchedule(id, 'weekly-report')).toMatchObject({ provider: null, model: null })
    })

    it('pins an explicit provider and model to the oldest connection of that provider', async () => {
        const { id, run } = freshAgent()
        const claude = await createConnection({ name: 'Claude', provider: 'claude', models: DEFAULT_CONNECTION_MODELS.claude, extraModels: [], keys: {} })
        await run('schedule_create', { ...base, runAt: '2026-10-05T09:00:00.000Z', provider: 'claude', model: 'claude-opus-4-8' })
        expect(await readSchedule(id, 'weekly-report')).toMatchObject({ runAt: '2026-10-05T09:00:00.000Z', cron: null, connectionId: claude.id, provider: 'claude', model: 'claude-opus-4-8' })
    })

    it('refuses a task with neither or both triggers', async () => {
        const { id, run } = freshAgent()
        expect(await run('schedule_create', base)).toBe('Provide either cron (recurring) or runAt (one-shot).')
        expect(await run('schedule_create', { ...base, cron: '0 9 * * 1', runAt: '2026-10-05T09:00:00.000Z' })).toBe('Provide only one of cron or runAt, not both.')
        expect(await listSchedules(id)).toEqual([])
    })

    it('refuses an invalid cron or timestamp', async () => {
        const { id, run } = freshAgent()
        expect(await run('schedule_create', { ...base, cron: 'every monday' })).toBe('Invalid cron expression: every monday')
        expect(await run('schedule_create', { ...base, runAt: 'next monday' })).toBe('Invalid runAt timestamp: next monday')
        expect(await listSchedules(id)).toEqual([])
    })
})

describe('schedule_update', () => {
    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('schedule_update', { slug: 'ghost', enabled: false })).toBe('Schedule not found: ghost')
    })

    it('refuses an invalid cron or timestamp and leaves the task untouched', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        expect(await run('schedule_update', { slug: 'digest', cron: '61 * * * *' })).toBe('Invalid cron expression: 61 * * * *')
        expect(await run('schedule_update', { slug: 'digest', runAt: 'soon' })).toBe('Invalid runAt timestamp: soon')
        expect((await readSchedule(id, 'digest')).cron).toBe('0 8 * * *')
    })

    it('changes the timing and model while keeping the rest', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', description: 'Daily digest', body: 'digest', cron: '0 8 * * *', provider: 'claude', model: 'claude-opus-4-8' })
        expect(await run('schedule_update', { slug: 'digest', cron: '30 7 * * *', timezone: 'Asia/Tokyo', provider: 'openai', model: 'gpt-5', description: 'Earlier digest' })).toBe('Updated schedule digest')
        expect(await readSchedule(id, 'digest')).toMatchObject({ description: 'Earlier digest', body: 'digest', cron: '30 7 * * *', timezone: 'Asia/Tokyo', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
    })

    it('pins the running connection when only a model is named', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        expect(await run('schedule_update', { slug: 'digest', model: 'gpt-5-mini' })).toBe('Updated schedule digest')
        expect(await readSchedule(id, 'digest')).toMatchObject({ connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5-mini' })
    })

    it('refuses a provider named without a model and leaves the pin untouched', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
        expect(await run('schedule_update', { slug: 'digest', provider: 'claude', description: 'Later' })).toBe('provider only goes with a model; nothing changed.')
        expect(await readSchedule(id, 'digest')).toMatchObject({ description: '', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
    })

    it('keeps the pin when neither provider nor model is named', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
        await run('schedule_update', { slug: 'digest', description: 'Later' })
        expect(await readSchedule(id, 'digest')).toMatchObject({ description: 'Later', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
    })

    it('does not report a body replacement when the body is unchanged', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        expect(await run('schedule_update', { slug: 'digest', body: 'digest' })).toBe('Updated schedule digest')
    })

    it('keeps the cron when a runAt is added, leaving a task with both', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        await run('schedule_update', { slug: 'digest', runAt: '2026-10-01T12:00:00.000Z' })
        // Looks wrong: schedule_create refuses both, but update cannot clear the cron it already has.
        expect(await readSchedule(id, 'digest')).toMatchObject({ cron: '0 8 * * *', runAt: '2026-10-01T12:00:00.000Z' })
    })

    it('writes to the slug it was given, not to the slug derived from the name', async () => {
        const { id, run } = freshAgent()
        await mkdir(schedulesDir(id), { recursive: true })
        await writeFile(scheduleFile(id, 'legacy'), '---\nname: Daily digest\ncron: 0 8 * * *\n---\ndigest\n')
        expect(await run('schedule_update', { slug: 'legacy', enabled: false })).toBe('Updated schedule legacy')
        expect((await readSchedule(id, 'legacy')).enabled).toBe(false)
        expect(scheduleExists(id, 'daily-digest')).toBe(false)
    })
})

describe('schedule_edit', () => {
    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('schedule_edit', { slug: 'ghost', oldString: 'a', newString: 'b', replaceAll: false })).toBe('Schedule not found: ghost')
    })

    it('refuses a no-op edit', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        expect(await run('schedule_edit', { slug: 'digest', oldString: 'digest', newString: 'digest', replaceAll: false })).toBe('oldString and newString are identical; nothing to do.')
    })

    it('replaces every occurrence with replaceAll and keeps the task settings', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'Check inbox. Summarize inbox. Archive inbox.', cron: '0 8 * * *', timezone: 'Europe/Paris', enabled: false, provider: 'claude', model: 'claude-opus-4-8' })
        expect(await run('schedule_edit', { slug: 'digest', oldString: 'inbox', newString: 'mailbox', replaceAll: true })).toBe('Edited schedule digest (3 replacements)')
        expect(await readSchedule(id, 'digest')).toMatchObject({ body: 'Check mailbox. Summarize mailbox. Archive mailbox.', cron: '0 8 * * *', timezone: 'Europe/Paris', enabled: false, provider: 'claude', model: 'claude-opus-4-8' })
    })
})

describe('schedule_delete', () => {
    it('deletes an existing task', async () => {
        const { id, run } = freshAgent()
        await writeSchedule(id, { name: 'Digest', body: 'digest', cron: '0 8 * * *' })
        expect(await run('schedule_delete', { slug: 'digest' })).toBe('Deleted schedule digest')
        expect(scheduleExists(id, 'digest')).toBe(false)
    })

    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('schedule_delete', { slug: 'ghost' })).toBe('Schedule not found: ghost')
    })
})
