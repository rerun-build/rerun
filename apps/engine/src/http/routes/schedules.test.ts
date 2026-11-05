import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-schedules-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''

const fired = vi.hoisted(() => [] as { agentId: string; slug: string; opts: unknown }[])

vi.mock('../../runtime/scheduler.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../runtime/scheduler.js')>()),
    fireSchedule: async (agentId: string, schedule: { slug: string }, opts: unknown) => {
        fired.push({ agentId, slug: schedule.slug, opts })
        return { runId: 'run-1', sessionId: 'session-1' }
    },
}))

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir, installPath } = await import('../../config/paths.js')
const { reloadAgent } = await import('../../agents/registry.js')

const id = 'scheduleagent'
const app = createServer()

type Schedule = { slug: string; name: string; description: string; body: string; cron: string | null; runAt: string | null; timezone: string | null; enabled: boolean; connectionId: string | null; provider: string | null; model: string | null }

function send(method: string, path: string, body?: unknown) {
    return app.request(`/agents/${id}/schedules${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function create(body: Record<string, unknown>): Promise<Schedule> {
    const res = await send('POST', '', body)
    expect(res.status).toBe(201)
    return (await res.json()) as Schedule
}

async function patch(slug: string, body: Record<string, unknown>): Promise<Schedule> {
    const res = await send('PATCH', `/${slug}`, body)
    expect(res.status).toBe(200)
    return (await res.json()) as Schedule
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'schedules' }))
})

describe('creating a schedule', () => {
    it('starts from an empty list', async () => {
        expect(await (await send('GET', '')).json()).toEqual({ schedules: [] })
    })

    it('creates a recurring schedule following the agent model', async () => {
        const schedule = await create({ name: 'Morning digest', body: 'Summarise the inbox', cron: '0 9 * * *', timezone: 'Europe/Paris' })
        expect(schedule).toMatchObject({ slug: 'morning-digest', description: '', cron: '0 9 * * *', runAt: null, timezone: 'Europe/Paris', enabled: true, provider: null, model: null })
        const { schedules } = (await (await send('GET', '')).json()) as { schedules: Schedule[] }
        expect(schedules.map(s => s.slug)).toContain('morning-digest')
    })

    it('creates a one-off schedule', async () => {
        const schedule = await create({ name: 'Launch reminder', body: 'Remind me', runAt: '2030-01-01T09:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        expect(schedule).toMatchObject({ cron: null, runAt: '2030-01-01T09:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet-4-6' })
    })

    it.each([
        ['both a cron and a runAt', { cron: '0 9 * * *', runAt: '2030-01-01T09:00:00.000Z' }, 'body: Provide exactly one of cron or runAt'],
        ['neither a cron nor a runAt', {}, 'body: Provide exactly one of cron or runAt'],
        ['an invalid cron', { cron: 'every morning' }, 'body: Invalid cron expression'],
        ['an invalid runAt', { runAt: 'tomorrow-ish' }, 'body: Invalid runAt timestamp'],
        ['a timezone croner cannot run', { cron: '0 9 * * *', timezone: 'Eastern' }, 'body: Invalid timezone'],
    ])('refuses %s', async (_, timing, error) => {
        const res = await send('POST', '', { name: 'Bad timing', body: 'x', ...timing })
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error })
    })

    it('refuses a schedule without a body', async () => {
        const res = await send('POST', '', { name: 'Empty', cron: '0 9 * * *' })
        expect(res.status).toBe(400)
        expect(((await res.json()) as { error: string }).error).toMatch(/^body: /)
    })
})

describe('reading a schedule', () => {
    it('reads one back by slug', async () => {
        await create({ name: 'Read me', body: 'Content', cron: '*/5 * * * *' })
        const res = await send('GET', '/read-me')
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ slug: 'read-me', body: 'Content', cron: '*/5 * * * *' })
    })

    it('404s on an unknown slug', async () => {
        const res = await send('GET', '/nope')
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'schedule not found' })
    })
})

describe('PATCH a schedule', () => {
    it('404s on an unknown slug', async () => {
        expect((await send('PATCH', '/nope', { enabled: false })).status).toBe(404)
    })

    it('changes only the fields it is given', async () => {
        await create({ name: 'Merge me', description: 'first', body: 'Original body', cron: '0 9 * * *', timezone: 'UTC', connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        const updated = await patch('merge-me', { description: 'second', enabled: false })
        expect(updated).toMatchObject({ name: 'Merge me', description: 'second', enabled: false, body: 'Original body', cron: '0 9 * * *', timezone: 'UTC', connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
    })

    it('clears the model pin with null', async () => {
        await create({ name: 'Unpin me', body: 'x', cron: '0 9 * * *', connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        expect(await patch('unpin-me', { connectionId: null, provider: null, model: null })).toMatchObject({ connectionId: null, provider: null, model: null })
        expect(await (await send('GET', '/unpin-me')).json()).toMatchObject({ connectionId: null, provider: null, model: null })
    })

    it('swaps the cron and the body', async () => {
        await create({ name: 'Retime me', body: 'old', cron: '0 9 * * *' })
        expect(await patch('retime-me', { cron: '30 18 * * 1-5', body: 'new' })).toMatchObject({ cron: '30 18 * * 1-5', body: 'new' })
    })

    it('refuses an invalid cron, runAt or timezone', async () => {
        await create({ name: 'Guard me', body: 'x', cron: '0 9 * * *' })
        const badCron = await send('PATCH', '/guard-me', { cron: 'nonsense' })
        expect(badCron.status).toBe(400)
        expect(await badCron.json()).toEqual({ error: 'invalid cron expression' })
        const badRunAt = await send('PATCH', '/guard-me', { runAt: 'soon' })
        expect(badRunAt.status).toBe(400)
        expect(await badRunAt.json()).toEqual({ error: 'invalid runAt timestamp' })
        const badTimezone = await send('PATCH', '/guard-me', { timezone: 'Eastern' })
        expect(badTimezone.status).toBe(400)
        expect(await badTimezone.json()).toEqual({ error: 'invalid timezone' })
        expect((await send('PATCH', '/guard-me', { enabled: 'yes' })).status).toBe(400)
    })

    it('renames the label and keeps the slug, so a later toggle stays in the same file', async () => {
        await create({ name: 'Compte rendu Chine', body: 'x', cron: '15 8 * * *' })
        expect(await patch('compte-rendu-chine', { name: '  Rapport Chine  ' })).toMatchObject({ slug: 'compte-rendu-chine', name: 'Rapport Chine' })
        expect(await patch('compte-rendu-chine', { enabled: false })).toMatchObject({ slug: 'compte-rendu-chine', name: 'Rapport Chine', enabled: false })
        const slugs = ((await (await send('GET', '')).json()) as { schedules: Schedule[] }).schedules.map(schedule => schedule.slug)
        expect(slugs).toContain('compte-rendu-chine')
        expect(slugs).not.toContain('rapport-chine')
    })

    it('refuses an empty name', async () => {
        await create({ name: 'Keep my name', body: 'x', cron: '0 9 * * *' })
        expect((await send('PATCH', '/keep-my-name', { name: '   ' })).status).toBe(400)
        expect(await (await send('GET', '/keep-my-name')).json()).toMatchObject({ name: 'Keep my name' })
    })

    // Looks wrong: the create route insists on exactly one of cron or runAt, the PATCH lets both stand.
    it('keeps the cron when a runAt is added', async () => {
        await create({ name: 'Both timings', body: 'x', cron: '0 9 * * *' })
        expect(await patch('both-timings', { runAt: '2030-01-01T09:00:00.000Z' })).toMatchObject({ cron: '0 9 * * *', runAt: '2030-01-01T09:00:00.000Z' })
    })
})

describe('running and deleting a schedule', () => {
    it('404s on running an unknown slug', async () => {
        expect((await send('POST', '/nope/run')).status).toBe(404)
        expect(fired).toEqual([])
    })

    it('fires a manual run without marking the schedule fired and past the budget latch', async () => {
        await create({ name: 'Run me', body: 'x', cron: '0 9 * * *' })
        const res = await send('POST', '/run-me/run')
        expect(res.status).toBe(202)
        expect(await res.json()).toEqual({ runId: 'run-1', sessionId: 'session-1' })
        expect(fired).toEqual([{ agentId: id, slug: 'run-me', opts: { markFired: false, ignoreBudgetLatch: true } }])
    })

    it('deletes a schedule', async () => {
        await create({ name: 'Delete me', body: 'x', cron: '0 9 * * *' })
        const res = await send('DELETE', '/delete-me')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: 'delete-me' })
        expect((await send('GET', '/delete-me')).status).toBe(404)
        expect((await send('DELETE', '/delete-me')).status).toBe(404)
    })
})

describe('running a schedule while the install is pending', () => {
    const installing = 'installingagent'
    const sendTo = (method: string, path: string, body?: unknown) =>
        app.request(`/agents/${installing}/schedules${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

    beforeAll(async () => {
        await mkdir(agentDir(installing), { recursive: true })
        await writeAgentConfig(installing, agentConfigSchema.parse({ name: 'installing', setup: { required: true } }))
        await writeFile(installPath(installing), 'Ask for the brand URL.\n', 'utf8')
        await reloadAgent(installing)
    })

    it('refuses a manual run of a schedule still paused for the install', async () => {
        expect((await sendTo('POST', '', { name: 'Daily shortlist', body: 'x', cron: '0 9 * * *', enabled: false })).status).toBe(201)
        const before = fired.length
        const res = await sendTo('POST', '/daily-shortlist/run')
        expect(res.status).toBe(409)
        expect(await res.json()).toEqual({ error: expect.stringContaining('still being set up') })
        expect(fired.length).toBe(before)
    })

    it('runs a schedule the user switched on by skipping the setup', async () => {
        expect((await sendTo('POST', '', { name: 'Weekly digest', body: 'x', cron: '0 9 * * 1', enabled: true })).status).toBe(201)
        const res = await sendTo('POST', '/weekly-digest/run')
        expect(res.status).toBe(202)
        expect(fired.at(-1)).toMatchObject({ agentId: installing, slug: 'weekly-digest' })
    })
})
