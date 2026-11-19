import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-getting-started-'))

const { sent } = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }))

vi.mock('./notify.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./notify.js')>()
    return {
        ...actual,
        sendNotification: async (input: Record<string, unknown>) => {
            sent.push(input)
            return { delivered: true }
        },
    }
})

const { beforeEach, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { RERUN_CONNECTION_ID } = await import('@rerun/contracts')
const { connectionRoutes } = await import('../http/routes/connections.js')
const { agentsDir, connectionsDir } = await import('../config/paths.js')
const { ensureRerunConnection } = await import('../connections/store.js')
const { unloadConnection } = await import('../connections/registry.js')
const { clearBoxDefault } = await import('../connections/default.js')
const { writeSchedule } = await import('../schedules/loader.js')
const { writeTrigger } = await import('../triggers/loader.js')
const { scheduleTools } = await import('../tools/builtin/schedule.js')
const { triggerTools } = await import('../tools/builtin/trigger.js')

function request(method: 'POST' | 'PATCH', path: string, body: unknown) {
    return connectionRoutes.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

const events = (event: string) => sent.filter(input => input.event === event)

beforeEach(async () => {
    sent.length = 0
    unloadConnection(RERUN_CONNECTION_ID)
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
    await rm(agentsDir(), { recursive: true, force: true })
    await ensureRerunConnection()
})

describe('box.connection.connected', () => {
    it('is sent when a connection is created with its credential', async () => {
        const res = await request('POST', '/', { name: 'Claude', provider: 'claude', models: ['opus'], keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' } })
        expect(res.status).toBe(201)
        expect(events('box.connection.connected')).toEqual([expect.objectContaining({ agentId: null, message: 'claude' })])
    })

    it('waits for the credential when the connection is created empty', async () => {
        const res = await request('POST', '/', { name: 'Claude', provider: 'claude', models: ['opus'], keys: {} })
        const { id } = (await res.json()) as { id: string }
        expect(events('box.connection.connected')).toEqual([])

        await request('PATCH', `/${id}/keys`, { set: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' }, remove: [] })
        expect(events('box.connection.connected')).toHaveLength(1)
    })

    it('is never sent for the keyless Rerun connection', async () => {
        await request('PATCH', `/${RERUN_CONNECTION_ID}`, { models: ['rerun-max'] })
        expect(events('box.connection.connected')).toEqual([])
    })
})

describe('agent.schedule.created', () => {
    it('is sent once, when the schedule is first written', async () => {
        await writeSchedule('agent-1', { name: 'Morning brief', body: 'Read the inbox.', cron: '0 8 * * *' })
        await writeSchedule('agent-1', { name: 'Morning brief', body: 'Read the inbox and reply.', cron: '0 9 * * *' })
        expect(events('agent.schedule.created')).toEqual([expect.objectContaining({ agentId: 'agent-1', message: 'Morning brief', metadata: { scheduleSlug: 'morning-brief' } })])
    })

    it('names the member whose chat message led the agent to create it', async () => {
        const tools = scheduleTools({ agent: { id: 'agent-1', config: { kind: 'user' } }, provider: 'claude', model: 'claude-opus-4-8', author: { id: 'u1', name: 'Marie' } } as any)
        await (tools.schedule_create as any).execute({ name: 'Morning brief', description: 'Daily', body: 'Read the inbox.', cron: '0 8 * * *' }, {})
        expect(events('agent.schedule.created')).toEqual([expect.objectContaining({ metadata: { scheduleSlug: 'morning-brief', authorId: 'u1' } })])
    })
})

describe('agent.trigger.created', () => {
    it('is sent once, when the trigger is first written', async () => {
        await writeTrigger('agent-1', { name: 'New lead', body: 'Qualify it.' })
        await writeTrigger('agent-1', { name: 'New lead', body: 'Qualify and score it.' })
        expect(events('agent.trigger.created')).toEqual([expect.objectContaining({ agentId: 'agent-1', message: 'New lead', metadata: { triggerSlug: 'new-lead' } })])
    })

    it('names the member whose chat message led the agent to create it', async () => {
        const tools = triggerTools({ agent: { id: 'agent-1' }, provider: 'claude', model: 'claude-opus-4-8', author: { id: 'u1', name: 'Marie' } } as any)
        await (tools.trigger_create as any).execute({ name: 'New lead', description: 'Form submitted', body: 'Qualify it.' }, {})
        expect(events('agent.trigger.created')).toEqual([expect.objectContaining({ metadata: { triggerSlug: 'new-lead', authorId: 'u1' } })])
    })
})
