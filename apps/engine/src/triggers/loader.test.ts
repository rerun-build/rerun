import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-triggers-'))

const { describe, expect, it } = await import('vitest')
const { readdir, readFile, writeFile } = await import('node:fs/promises')
const { triggerFile, triggersDir } = await import('../config/paths.js')
const { isSafeSlug, listTriggers, markFired, readTrigger, rotateTriggerToken, setTriggerEnabled, triggerExists, writeTrigger } = await import('./loader.js')

const agentId = 'triggeragent'

describe('isSafeSlug', () => {
    it('rejects anything that is not a plain lowercase slug', () => {
        for (const slug of ['../secrets', '..', 'a/b', '/etc/passwd', 'Upper', '-leading', '', 'a'.repeat(65)]) {
            expect(isSafeSlug(slug), slug).toBe(false)
        }
    })

    it('accepts a normal slug', () => {
        for (const slug of ['github-push', 'a', '2fa-check']) {
            expect(isSafeSlug(slug), slug).toBe(true)
        }
    })
})

describe('trigger files', () => {
    it('round-trips through the markdown file', async () => {
        const created = await writeTrigger(agentId, { name: 'GitHub push', description: 'On main', body: 'Review the diff.', methods: ['POST', 'GET'] })
        expect(created.slug).toBe('github-push')
        expect(created.token).toHaveLength(21)

        const read = await readTrigger(agentId, 'github-push')
        expect(read).toEqual(created)
        expect(read.methods).toEqual(['POST', 'GET'])
        expect(read.fireCount).toBe(0)
        expect(read.enabled).toBe(true)
    })

    it('defaults to POST only', async () => {
        const created = await writeTrigger(agentId, { name: 'Default methods', body: 'Run.' })
        expect(created.methods).toEqual(['POST'])
    })

    it('keeps the token across an update', async () => {
        const created = await writeTrigger(agentId, { name: 'Stable token', body: 'One.' })
        const updated = await writeTrigger(agentId, { name: 'Stable token', body: 'Two.' })
        expect(updated.token).toBe(created.token)
        expect(updated.body).toBe('Two.')
        expect(updated.createdAt).toBe(created.createdAt)
    })

    it('issues a new token on rotation', async () => {
        const created = await writeTrigger(agentId, { name: 'Rotate me', body: 'Run.' })
        const rotated = await rotateTriggerToken(agentId, 'rotate-me')
        expect(rotated.token).not.toBe(created.token)
        expect((await readTrigger(agentId, 'rotate-me')).token).toBe(rotated.token)
    })

    it('counts fires and records the last one', async () => {
        await writeTrigger(agentId, { name: 'Counter', body: 'Run.' })
        await markFired(agentId, 'counter', '2026-08-10T10:00:00.000Z')
        await markFired(agentId, 'counter', '2026-08-10T11:00:00.000Z')
        const trigger = await readTrigger(agentId, 'counter')
        expect(trigger.fireCount).toBe(2)
        expect(trigger.lastFiredAt).toBe('2026-08-10T11:00:00.000Z')
    })

    it('refuses a name that slugifies to nothing', async () => {
        await expect(writeTrigger(agentId, { name: '!!!', body: 'Run.' })).rejects.toThrow()
    })

    it('reports an unsafe slug as absent instead of touching the filesystem', () => {
        expect(triggerExists(agentId, '../../../etc/passwd')).toBe(false)
    })

    it('lists what was written', async () => {
        const triggers = await listTriggers(agentId)
        expect(triggers.map(t => t.slug)).toContain('github-push')
    })
})

describe('concurrent writes', () => {
    it('keeps the token and the body through a burst of fires, and counts every one', async () => {
        const created = await writeTrigger(agentId, { name: 'Burst', body: 'Handle the event.' })
        await Promise.all(Array.from({ length: 25 }, (_, i) => markFired(agentId, 'burst', `2026-10-16T13:25:${String(i).padStart(2, '0')}.000Z`)))

        const after = await readTrigger(agentId, 'burst')
        expect(after.token).toBe(created.token)
        expect(after.body).toBe('Handle the event.')
        expect(after.createdAt).toBe(created.createdAt)
        expect(after.fireCount).toBe(25)
    })

    it('keeps an edit made while fires are landing', async () => {
        const created = await writeTrigger(agentId, { name: 'Edited mid burst', body: 'Old.' })
        await Promise.all([
            ...Array.from({ length: 10 }, () => markFired(agentId, 'edited-mid-burst', '2026-10-16T13:25:00.000Z')),
            writeTrigger(agentId, { name: 'Edited mid burst', body: 'New.' }),
            ...Array.from({ length: 10 }, () => markFired(agentId, 'edited-mid-burst', '2026-10-16T13:25:01.000Z')),
        ])

        const after = await readTrigger(agentId, 'edited-mid-burst')
        expect(after.token).toBe(created.token)
        expect(after.body).toBe('New.')
        expect(after.fireCount).toBe(20)
    })

    it('leaves no temp file behind', async () => {
        await writeTrigger(agentId, { name: 'Tidy', body: 'Run.' })
        await Promise.all(Array.from({ length: 10 }, () => markFired(agentId, 'tidy', '2026-10-16T13:25:00.000Z')))
        expect((await readdir(triggersDir(agentId))).filter(name => name.endsWith('.tmp'))).toEqual([])
    })

    it('refuses to rewrite a file that has no front matter', async () => {
        await writeTrigger(agentId, { name: 'Emptied', body: 'Run.' })
        await writeFile(triggerFile(agentId, 'emptied'), '')
        await expect(markFired(agentId, 'emptied', '2026-10-16T13:25:00.000Z')).rejects.toThrow(/front matter/)
        expect(await readFile(triggerFile(agentId, 'emptied'), 'utf8')).toBe('')
    })
})

describe('setTriggerEnabled', () => {
    it('issues a token when it turns on a trigger that has none', async () => {
        await writeTrigger(agentId, { name: 'From archive', body: 'Run.', enabled: false })
        const raw = await readFile(triggerFile(agentId, 'from-archive'), 'utf8')
        await writeFile(triggerFile(agentId, 'from-archive'), raw.replace(/^token: .+$/m, "token: ''"))
        expect((await readTrigger(agentId, 'from-archive')).token).toBe('')

        await setTriggerEnabled(agentId, 'from-archive', true)
        const enabled = await readTrigger(agentId, 'from-archive')
        expect(enabled.enabled).toBe(true)
        expect(enabled.token).toHaveLength(21)
    })

    it('keeps the token it already has', async () => {
        const created = await writeTrigger(agentId, { name: 'Toggled', body: 'Run.' })
        await setTriggerEnabled(agentId, 'toggled', false)
        await setTriggerEnabled(agentId, 'toggled', true)
        expect((await readTrigger(agentId, 'toggled')).token).toBe(created.token)
    })
})
