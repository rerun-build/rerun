import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-au-'))

const { beforeEach, describe, expect, it } = await import('vitest')
const { activateAutomations } = await import('./automations.js')
const { agentConfigSchema } = await import('./types.js')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { agentDir, scheduleFile, schedulesDir, triggerFile, triggersDir } = await import('../config/paths.js')
const { readSchedule } = await import('../schedules/loader.js')
const { readTrigger } = await import('../triggers/loader.js')

const AGENT_ID = 'automationsagent'

function agentOf(enabled: boolean) {
    return { id: AGENT_ID, config: agentConfigSchema.parse({ name: 'automations', enabled }), soul: '', install: '', env: {} }
}

async function writeSchedule(slug: string, frontmatter: string): Promise<void> {
    await writeFile(scheduleFile(AGENT_ID, slug), `---\n${frontmatter}\n---\n\nDo the thing.`, 'utf8')
}

async function writeTrigger(slug: string, frontmatter: string): Promise<void> {
    await writeFile(triggerFile(AGENT_ID, slug), `---\n${frontmatter}\n---\n\nHandle the call.`, 'utf8')
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

beforeEach(async () => {
    await rm(agentDir(AGENT_ID), { recursive: true, force: true })
    await mkdir(schedulesDir(AGENT_ID), { recursive: true })
    await mkdir(triggersDir(AGENT_ID), { recursive: true })
})

describe('activateAutomations', () => {
    it('switches on a captured cron and rebaselines it so it does not fire in catch-up', async () => {
        await writeSchedule('daily', "name: Daily\ncron: 0 9 * * *\nenabled: false\nlastRunAt: '2026-01-01T09:00:00.000Z'")

        const activated = await activateAutomations(agentOf(true))
        const schedule = await readSchedule(AGENT_ID, 'daily')

        expect(activated.schedules).toEqual(['daily'])
        expect(schedule.enabled).toBe(true)
        expect(new Date(schedule.lastRunAt as string).getTime()).toBeGreaterThan(Date.parse('2026-01-02T00:00:00.000Z'))
    })

    it('leaves a running schedule strictly alone', async () => {
        await writeSchedule('daily', "name: Daily\ncron: 0 9 * * *\nenabled: true\nlastRunAt: '2026-01-01T09:00:00.000Z'")
        const before = await readFile(scheduleFile(AGENT_ID, 'daily'), 'utf8')

        const activated = await activateAutomations(agentOf(true))

        expect(activated.schedules).toEqual([])
        expect(await readFile(scheduleFile(AGENT_ID, 'daily'), 'utf8')).toBe(before)
    })

    it('switches on a one-off still ahead and leaves an expired one off', async () => {
        await writeSchedule('later', `name: Later\nrunAt: '${inDays(3)}'\nenabled: false`)
        await writeSchedule('missed', "name: Missed\nrunAt: '2026-01-01T09:00:00.000Z'\nenabled: false")

        const activated = await activateAutomations(agentOf(true))

        expect(activated.schedules).toEqual(['later'])
        expect((await readSchedule(AGENT_ID, 'later')).enabled).toBe(true)
        expect((await readSchedule(AGENT_ID, 'missed')).enabled).toBe(false)
    })

    it('switches on the webhooks the agent created during its install', async () => {
        await writeTrigger('inbound', 'name: Inbound\nenabled: false\ntoken: tok\nmethods:\n  - POST')

        const activated = await activateAutomations(agentOf(true))

        expect(activated.triggers).toEqual(['inbound'])
        expect((await readTrigger(AGENT_ID, 'inbound')).enabled).toBe(true)
    })

    it('does nothing at all for an agent the platform switched off', async () => {
        await writeSchedule('daily', 'name: Daily\ncron: 0 9 * * *\nenabled: false')
        await writeTrigger('inbound', 'name: Inbound\nenabled: false\ntoken: tok')

        const activated = await activateAutomations(agentOf(false))

        expect(activated).toEqual({ schedules: [], triggers: [] })
        expect((await readSchedule(AGENT_ID, 'daily')).enabled).toBe(false)
        expect((await readTrigger(AGENT_ID, 'inbound')).enabled).toBe(false)
    })
})
