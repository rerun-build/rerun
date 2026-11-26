import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { RemoteComputerView } from '@rerun/contracts'

const computers = vi.hoisted(() => ({ views: [] as RemoteComputerView[] }))
vi.mock('../../remote/registry.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../remote/registry.js')>()),
    listComputerViews: async () => computers.views,
}))

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-schedules-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it, beforeEach } = await import('vitest')
const { scheduleTools } = await import('./schedule.js')
const { readSchedule, writeSchedule } = await import('../../schedules/loader.js')

const id = 'testagent'
const ctx = { agent: { id, config: { kind: 'user', tools: { shell: true, remoteComputers: true } }, resolved: { connection: { id: 'cnx-claude' }, provider: 'claude', model: 'claude-opus-4-8' } }, provider: 'claude', model: 'claude-opus-4-8' } as any
const tools = scheduleTools(ctx)
const slug = 'daily-research'

const BODY = ['Run the daily research.', '', '1. Map both sources.', '2. Scrape only the unseen listings.', '3. Save exactly 10 ideas.'].join('\n')

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    return (await (tools[name] as any).execute(args, {} as any)) as string
}

beforeEach(async () => {
    await writeSchedule(id, {
        name: 'Daily research',
        description: 'Daily template research',
        body: BODY,
        cron: '0 8 * * *',
        timezone: 'Europe/Paris',
        provider: 'claude',
        model: 'claude-opus-4-8',
    })
})

describe('schedule_get', () => {
    it('returns the full instruction body', async () => {
        const res = await run('schedule_get', { slug })
        expect(res).toContain('Daily research (daily-research)')
        expect(res).toContain('Cron: 0 8 * * *')
        expect(res).toContain('Timezone: Europe/Paris')
        expect(res).toContain('2. Scrape only the unseen listings.')
    })

    it('reports an unknown slug', async () => {
        expect(await run('schedule_get', { slug: 'nope' })).toBe('Schedule not found: nope')
    })
})

describe('schedule_edit', () => {
    it('replaces one excerpt and preserves the rest', async () => {
        const res = await run('schedule_edit', { slug, oldString: '3. Save exactly 10 ideas.', newString: '3. Save exactly 12 ideas.' })
        expect(res).toBe('Edited schedule daily-research (1 replacement)')
        const schedule = await readSchedule(id, slug)
        expect(schedule.body).toContain('3. Save exactly 12 ideas.')
        expect(schedule.body).toContain('1. Map both sources.')
        expect(schedule.cron).toBe('0 8 * * *')
        expect(schedule.timezone).toBe('Europe/Paris')
    })

    it('points at schedule_get when oldString is absent, and changes nothing', async () => {
        const res = await run('schedule_edit', { slug, oldString: 'a line that was never there', newString: 'whatever' })
        expect(res).toContain('Call schedule_get to read the current body')
        expect(res).toContain('Never fall back to rewriting the whole body from memory')
        expect((await readSchedule(id, slug)).body).toBe(BODY)
    })

    it('refuses an ambiguous match without replaceAll', async () => {
        const res = await run('schedule_edit', { slug, oldString: 'the', newString: 'THE' })
        expect(res).toContain('pass replaceAll or provide a more specific string')
        expect((await readSchedule(id, slug)).body).toBe(BODY)
    })
})

describe('a timezone croner cannot run', () => {
    it('is refused on create, and nothing is written', async () => {
        const res = await run('schedule_create', { name: 'Morning brief', description: 'x', body: 'x', cron: '0 9 * * *', timezone: 'Eastern' })
        expect(res).toBe("Invalid timezone: Eastern. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.")
        await expect(readSchedule(id, 'morning-brief')).rejects.toThrow()
    })
    it('is refused on update, and the schedule keeps its timezone', async () => {
        const res = await run('schedule_update', { slug, timezone: 'Europe/Pariss' })
        expect(res).toBe("Invalid timezone: Europe/Pariss. Use an IANA name, e.g. 'Europe/Paris' or 'America/New_York'.")
        expect((await readSchedule(id, slug)).timezone).toBe('Europe/Paris')
    })
})

describe('schedule_update', () => {
    it('reports the size of a body it replaced', async () => {
        const res = await run('schedule_update', { slug, body: 'Run the daily research.' })
        expect(res).toBe(`Updated schedule ${slug} (body replaced: ${BODY.length} → 23 chars)`)
    })

    it('leaves the body alone when none is passed', async () => {
        const res = await run('schedule_update', { slug, enabled: false })
        expect(res).toBe(`Updated schedule ${slug}`)
        const schedule = await readSchedule(id, slug)
        expect(schedule.body).toBe(BODY)
        expect(schedule.enabled).toBe(false)
    })
})

describe('a promise of the Chief of Staff', () => {
    const foreman = scheduleTools({ ...ctx, agent: { ...ctx.agent, id: 'foreman', config: { kind: 'foreman' } } })

    it('is a routine it creates with checkIn, which wakes it in a check-in', async () => {
        const res = await (foreman.schedule_create as any).execute({ name: 'Back on the invoices', description: 'Check the invoices coworker', body: 'See whether the Stripe sign-in of the invoices coworker was fixed, for Ana.', runAt: '2026-11-21T08:00:00.000Z', checkIn: true }, {})
        expect(res).toBe('Created schedule back-on-the-invoices: it wakes you in a check-in')
        expect((await readSchedule('foreman', 'back-on-the-invoices')).checkIn).toBe(true)
        expect(await (foreman.schedule_get as any).execute({ slug: 'back-on-the-invoices' }, {})).toContain('Wakes you in a check-in')
    })

    it('is not offered to a coworker, whose routines stay plain runs', async () => {
        expect(JSON.stringify((tools.schedule_create as any).inputSchema)).not.toContain('checkIn')
        await run('schedule_create', { name: 'Sneaky', description: 'x', body: 'y', cron: '0 8 * * *', checkIn: true })
        expect((await readSchedule(id, 'sneaky')).checkIn).toBe(false)
    })

    it('keeps the file of every other routine as it was', async () => {
        const { readFile } = await import('node:fs/promises')
        const { scheduleFile } = await import('../../config/paths.js')
        expect(await readFile(scheduleFile(id, slug), 'utf8')).not.toContain('checkIn')
    })
})

function computer(settings: Partial<RemoteComputerView['settings']> = {}): RemoteComputerView {
    return {
        id: 'c1',
        handle: 'synology',
        name: 'Synology',
        online: false,
        paused: false,
        connectedAt: null,
        lastSeenAt: null,
        appVersion: null,
        protocol: 1,
        capabilities: ['shell', 'jobs'],
        facts: null,
        settings: { mode: 'remember', unattended: true, allowedPrograms: ['python3'], allowedFolders: [], screenAlways: false, ...settings },
        runningJobs: 0,
    }
}

describe('a script routine', () => {
    const script = { runsOn: null, folder: 'shared/', timeoutSec: 300, notify: 'failures' } as const
    beforeEach(async () => {
        computers.views = [computer()]
        await writeSchedule(id, { name: 'Sync prices', body: 'python3 sync.py', cron: '0 */6 * * *', kind: 'script', script })
    })

    it('is created by a coworker on the workspace machine, with no model', async () => {
        const res = await run('schedule_create', { name: 'Backup', description: 'Nightly backup', body: 'python3 backup.py', cron: '0 2 * * *', script: { folder: 'workspace/scripts', timeoutMinutes: 15 } })
        expect(res).toBe('Created schedule backup')
        expect(await readSchedule(id, 'backup')).toMatchObject({ kind: 'script', body: 'python3 backup.py', model: null, provider: null, connectionId: null, script: { runsOn: null, folder: 'workspace/scripts', timeoutSec: 900, notify: 'failures' } })
        expect(await run('schedule_get', { slug: 'backup' })).toContain('Command: python3 backup.py')
    })

    it('is created on a linked computer named by its handle, which it keeps by id', async () => {
        expect(await run('schedule_create', { name: 'NAS backup', description: 'x', body: 'python3 backup.py', cron: '0 2 * * *', script: { runsOn: '#synology', notifyOnSuccess: true } })).toBe('Created schedule nas-backup')
        expect((await readSchedule(id, 'nas-backup')).script).toEqual({ runsOn: 'c1', folder: '', timeoutSec: 300, notify: 'always' })
        expect(await run('schedule_get', { slug: 'nas-backup' })).toContain('the linked computer #synology')
    })

    it('is created with a warning when the computer will not take it without anyone there', async () => {
        computers.views = [computer({ unattended: false })]
        const res = await run('schedule_create', { name: 'NAS backup', description: 'x', body: 'python3 backup.py', cron: '0 2 * * *', script: { runsOn: 'synology' } })
        expect(res).toContain('Created schedule nas-backup, but it will fail as things stand: #synology only takes work while someone is in a chat')
    })

    it('is refused, and nothing is written, without the tools that run it', async () => {
        const noShell = scheduleTools({ ...ctx, agent: { ...ctx.agent, config: { kind: 'user', tools: { shell: false, remoteComputers: false } } } })
        const create = (args: Record<string, unknown>) => (noShell.schedule_create as any).execute({ description: 'x', body: 'python3 x.py', cron: '0 2 * * *', ...args }, {})
        expect(await create({ name: 'On the box', script: {} })).toContain('You have no shell')
        expect(await create({ name: 'On the nas', script: { runsOn: '#synology' } })).toContain('You do not reach the linked computers')
        await expect(readSchedule(id, 'on-the-box')).rejects.toThrow()
    })

    it('refuses a model, a folder outside the workspace, a blocked command, an unknown computer and a bad limit', async () => {
        const create = (args: Record<string, unknown>) => run('schedule_create', { name: 'Bad', description: 'x', body: 'python3 x.py', cron: '0 2 * * *', ...args })
        expect(await create({ model: 'claude-opus-4-8', script: {} })).toContain('A script runs no model')
        expect(await create({ script: { folder: '../etc' } })).toContain('The folder must be inside shared/ or workspace/')
        expect(await create({ body: 'rm -rf / ', script: {} })).toContain('Command blocked by policy')
        expect(await create({ body: 'sudo reboot', script: { runsOn: '#synology' } })).toContain('Not set up on #synology')
        expect(await create({ script: { runsOn: '#studio' } })).toContain('No computer is called #studio')
        expect(await create({ script: { timeoutMinutes: 7 } })).toContain('timeoutMinutes must be one of 1, 5, 15, 60')
        await expect(readSchedule(id, 'bad')).rejects.toThrow()
    })

    it('has its command changed by an update or an edit, checked again', async () => {
        expect(await run('schedule_update', { slug: 'sync-prices', body: 'python3 sync.py --all' })).toContain('Updated schedule sync-prices')
        expect(await run('schedule_edit', { slug: 'sync-prices', oldString: '--all', newString: '--fast' })).toBe('Edited schedule sync-prices (1 replacement)')
        expect(await run('schedule_edit', { slug: 'sync-prices', oldString: 'python3 sync.py --fast', newString: 'rm -rf / ' })).toContain('Command blocked by policy')
        expect(await readSchedule(id, 'sync-prices')).toMatchObject({ kind: 'script', body: 'python3 sync.py --fast' })
    })

    it('moves to a linked computer and back with an update', async () => {
        expect(await run('schedule_update', { slug: 'sync-prices', script: { runsOn: '#synology', folder: '/volume1/scripts' } })).toBe('Updated schedule sync-prices')
        expect((await readSchedule(id, 'sync-prices')).script).toMatchObject({ runsOn: 'c1', folder: '/volume1/scripts' })
        expect(await run('schedule_update', { slug: 'sync-prices', script: { runsOn: 'workspace' } })).toBe('Updated schedule sync-prices')
        expect((await readSchedule(id, 'sync-prices')).script).toMatchObject({ runsOn: null, folder: 'shared/' })
    })

    it('stays a script, and an instruction stays an instruction', async () => {
        expect(await run('schedule_update', { slug: 'sync-prices', model: 'claude-opus-4-8' })).toContain('A script runs no model')
        expect(await run('schedule_create', { name: 'Sync prices', description: 'x', body: 'Look at the prices', cron: '0 9 * * *' })).toContain('already exists (sync-prices) and runs a command')
        expect(await run('schedule_update', { slug, script: {} })).toContain('is an instruction: to run a command instead')
        expect(await run('schedule_create', { name: 'Daily research', description: 'x', body: 'python3 x.py', cron: '0 9 * * *', script: {} })).toContain('already exists (daily-research) and is an instruction')
        expect(await readSchedule(id, 'sync-prices')).toMatchObject({ kind: 'script', body: 'python3 sync.py', model: null })
    })

    it('still lets the coworker pause it or move its time', async () => {
        expect(await run('schedule_update', { slug: 'sync-prices', enabled: false, cron: '0 7 * * *' })).toBe('Updated schedule sync-prices')
        expect(await readSchedule(id, 'sync-prices')).toMatchObject({ enabled: false, cron: '0 7 * * *', body: 'python3 sync.py' })
    })
})
