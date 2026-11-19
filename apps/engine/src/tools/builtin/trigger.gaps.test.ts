import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-trigger-gaps-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it, vi } = await import('vitest')

const hub = vi.hoisted(() => ({ calls: [] as { agentId: string; tool: string; args: Record<string, unknown> }[], reply: null as unknown, fails: false }))

vi.mock('../../runtime/hub.js', () => ({
    callHub: async (caller: { id: string }, tool: string, args: Record<string, unknown>) => {
        hub.calls.push({ agentId: caller.id, tool, args })
        if (hub.fails) throw new Error('Service catalog is unavailable')
        return hub.reply
    },
}))

const { DEFAULT_CONNECTION_MODELS } = await import('@moldwright/contracts')
const { createConnection } = await import('../../connections/store.js')
const { triggerTools } = await import('./trigger.js')
const { markFired, readTrigger, triggerExists, writeTrigger } = await import('../../triggers/loader.js')
const { triggerFile, triggersDir } = await import('../../config/paths.js')

const NO_URL = "Its public URL is not available from here — open the coworker's Triggers tab in Rerun to copy it."

let agentCount = 0

function freshAgent() {
    const id = `trig-${++agentCount}`
    const tools = triggerTools({ agent: { id, resolved: { connection: { id: 'cnx-openai' }, provider: 'openai', model: 'gpt-5' } }, provider: 'openai', model: 'gpt-5' } as any)
    const run = async (name: string, args: Record<string, unknown>) => (await (tools[name] as any).execute(args, {} as any)) as string
    return { id, run }
}

beforeEach(() => {
    hub.calls = []
    hub.reply = null
    hub.fails = false
})

describe('trigger_list', () => {
    it('says so when there are no triggers', async () => {
        expect(await freshAgent().run('trigger_list', {})).toBe('No webhook triggers yet.')
    })

    it('shows methods, call counts and disabled triggers', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'New lead', body: 'lead', methods: ['GET', 'POST'] })
        await writeTrigger(id, { name: 'Fresh hook', body: 'fresh' })
        await writeTrigger(id, { name: 'Old hook', body: 'old', enabled: false })
        await markFired(id, 'new-lead', '2026-09-30T08:00:00.000Z')
        const lines = (await run('trigger_list', {})).split('\n').sort()
        expect(lines).toEqual(['- Fresh hook (fresh-hook): POST, 0 call(s)', '- New lead (new-lead): GET/POST, 1 call(s), last 2026-09-30T08:00:00.000Z', '- Old hook (old-hook): POST, disabled'])
    })
})

describe('trigger_create', () => {
    it('creates a POST trigger that follows the agent and hands back its public URL', async () => {
        const { id, run } = freshAgent()
        hub.reply = { url: 'https://app.rerun.build/api/triggers/abc/new-lead' }
        expect(await run('trigger_create', { name: 'New lead', description: 'Form submitted', body: 'Qualify the lead.' })).toBe('Created trigger new-lead (POST). Its public URL is https://app.rerun.build/api/triggers/abc/new-lead')
        const trigger = await readTrigger(id, 'new-lead')
        expect(trigger).toMatchObject({ description: 'Form submitted', body: 'Qualify the lead.', methods: ['POST'], connectionId: null, provider: null, model: null, enabled: true })
        expect(hub.calls).toEqual([{ agentId: id, tool: 'trigger_url', args: { slug: 'new-lead', token: trigger.token } }])
    })

    it('keeps explicit methods and pins the model to the oldest connection of its provider, and falls back to the Triggers tab without a hub', async () => {
        const { id, run } = freshAgent()
        hub.fails = true
        const claude = await createConnection({ name: 'Claude', provider: 'claude', models: DEFAULT_CONNECTION_MODELS.claude, extraModels: [], keys: {} })
        expect(await run('trigger_create', { name: 'Ping', description: 'd', body: 'b', methods: ['GET', 'POST'], provider: 'claude', model: 'claude-opus-4-8' })).toBe(`Created trigger ping (GET/POST). ${NO_URL}`)
        expect(await readTrigger(id, 'ping')).toMatchObject({ methods: ['GET', 'POST'], connectionId: claude.id, provider: 'claude', model: 'claude-opus-4-8' })
    })

    it('pins the running connection and provider for a model named without one', async () => {
        const { id, run } = freshAgent()
        await run('trigger_create', { name: 'Ping', description: 'd', body: 'b', model: 'gpt-5-mini' })
        expect(await readTrigger(id, 'ping')).toMatchObject({ connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5-mini' })
    })

    it('refuses a provider nobody plugged into the box and creates nothing', async () => {
        const { id, run } = freshAgent()
        expect(await run('trigger_create', { name: 'Ping', description: 'd', body: 'b', provider: 'google', model: 'gemini-2.5-pro' })).toBe(
            'No google connection is plugged into this box, so a task pinned to gemini-2.5-pro would fall back to your own model. Leave provider and model out so it follows you, or ask the user to connect google first.'
        )
        expect(triggerExists(id, 'ping')).toBe(false)
        expect(hub.calls).toEqual([])
    })

    it('treats a hub reply without a URL as no URL', async () => {
        hub.reply = { error: 'agent not linked' }
        expect(await freshAgent().run('trigger_create', { name: 'Ping', description: 'd', body: 'b' })).toBe(`Created trigger ping (POST). ${NO_URL}`)
    })
})

describe('trigger_get', () => {
    it('shows call history and the public URL', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'New lead', body: 'Qualify the lead.', methods: ['PUT'] })
        await markFired(id, 'new-lead', '2026-09-30T08:00:00.000Z')
        hub.reply = { url: 'https://hooks.test/new-lead' }
        expect(await run('trigger_get', { slug: 'new-lead' })).toBe(
            ['New lead (new-lead)', 'Methods: PUT', 'Enabled: true', 'Calls: 1 (last 2026-09-30T08:00:00.000Z)', 'Its public URL is https://hooks.test/new-lead', 'Qualify the lead.'].join('\n'),
        )
    })

    it('reports an unknown or unsafe slug without calling the hub', async () => {
        const { run } = freshAgent()
        expect(await run('trigger_get', { slug: 'ghost' })).toBe('Trigger not found: ghost')
        expect(await run('trigger_get', { slug: '../escape' })).toBe('Trigger not found: ../escape')
        expect(hub.calls).toEqual([])
    })
})

describe('trigger_edit', () => {
    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('trigger_edit', { slug: 'ghost', oldString: 'a', newString: 'b', replaceAll: false })).toBe('Trigger not found: ghost')
    })

    it('refuses a no-op edit', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'same' })
        expect(await run('trigger_edit', { slug: 'hook', oldString: 'same', newString: 'same', replaceAll: false })).toBe('oldString and newString are identical; nothing to do.')
    })

    it('replaces every occurrence with replaceAll and keeps the trigger settings', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'Read lead. Score lead. File lead.', methods: ['GET'], enabled: false, provider: 'claude', model: 'claude-opus-4-8' })
        const before = await readTrigger(id, 'hook')
        expect(await run('trigger_edit', { slug: 'hook', oldString: 'lead', newString: 'prospect', replaceAll: true })).toBe('Edited trigger hook (3 replacements)')
        expect(await readTrigger(id, 'hook')).toMatchObject({ body: 'Read prospect. Score prospect. File prospect.', methods: ['GET'], enabled: false, provider: 'claude', model: 'claude-opus-4-8', token: before.token })
    })

    it('writes to the slug derived from the name, minting a second token', async () => {
        const { id, run } = freshAgent()
        await mkdir(triggersDir(id), { recursive: true })
        await writeFile(triggerFile(id, 'legacy'), '---\nname: New lead\ntoken: original-token\n---\nQualify the lead.\n')
        expect(await run('trigger_edit', { slug: 'legacy', oldString: 'Qualify', newString: 'Score', replaceAll: false })).toBe('Edited trigger legacy (1 replacement)')
        expect(await readTrigger(id, 'legacy')).toMatchObject({ body: 'Qualify the lead.', token: 'original-token' })
        const copy = await readTrigger(id, 'new-lead')
        expect(copy.body).toBe('Score the lead.')
        expect(copy.token).not.toBe('original-token')
    })
})

describe('trigger_update', () => {
    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('trigger_update', { slug: 'ghost', enabled: false })).toBe('Trigger not found: ghost')
    })

    it('changes methods, description and model while keeping the token', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', description: 'old', body: 'b', provider: 'claude', model: 'claude-opus-4-8' })
        const before = await readTrigger(id, 'hook')
        expect(await run('trigger_update', { slug: 'hook', description: 'new', methods: ['GET', 'POST'], provider: 'openai', model: 'gpt-5', body: 'b' })).toBe('Updated trigger hook')
        expect(await readTrigger(id, 'hook')).toMatchObject({ description: 'new', methods: ['GET', 'POST'], connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5', body: 'b', token: before.token })
    })

    it('pins the running connection when only a model is named', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'b' })
        expect(await run('trigger_update', { slug: 'hook', model: 'gpt-5-mini' })).toBe('Updated trigger hook')
        expect(await readTrigger(id, 'hook')).toMatchObject({ connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5-mini' })
    })

    it('refuses a provider named without a model and leaves the pin untouched', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'b', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
        expect(await run('trigger_update', { slug: 'hook', provider: 'claude', description: 'new' })).toBe('provider only goes with a model; nothing changed.')
        expect(await readTrigger(id, 'hook')).toMatchObject({ description: '', connectionId: 'cnx-openai', provider: 'openai', model: 'gpt-5' })
    })
})

describe('trigger_rotate_token', () => {
    it('mints a new token and returns the new URL', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'b' })
        const before = await readTrigger(id, 'hook')
        hub.reply = { url: 'https://hooks.test/rotated' }
        expect(await run('trigger_rotate_token', { slug: 'hook' })).toBe('Rotated the secret of hook. Its public URL is https://hooks.test/rotated')
        const after = await readTrigger(id, 'hook')
        expect(after.token).not.toBe(before.token)
        expect(hub.calls.at(-1)?.args).toEqual({ slug: 'hook', token: after.token })
    })

    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('trigger_rotate_token', { slug: 'ghost' })).toBe('Trigger not found: ghost')
    })
})

describe('trigger_delete', () => {
    it('deletes an existing trigger', async () => {
        const { id, run } = freshAgent()
        await writeTrigger(id, { name: 'Hook', body: 'b' })
        expect(await run('trigger_delete', { slug: 'hook' })).toBe('Deleted trigger hook')
        expect(triggerExists(id, 'hook')).toBe(false)
    })

    it('reports an unknown slug', async () => {
        expect(await freshAgent().run('trigger_delete', { slug: 'ghost' })).toBe('Trigger not found: ghost')
    })
})
