import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-schedules-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it, beforeEach } = await import('vitest')
const { scheduleTools } = await import('./schedule.js')
const { readSchedule, writeSchedule } = await import('../../schedules/loader.js')

const id = 'testagent'
const ctx = { agent: { id, resolved: { connection: { id: 'cnx-claude' }, provider: 'claude', model: 'claude-opus-4-8' } }, provider: 'claude', model: 'claude-opus-4-8' } as any
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
