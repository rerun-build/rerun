import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-checkin-flow-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_DESKTOP = 'off'

const { sent, hub, script } = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>>, hub: { down: false }, script: { mode: 'sneak' as 'sneak' | 'speak' } }))

vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
        if (hub.down) return { delivered: false, reason: 'status 503' }
        sent.push(input)
        return { delivered: true }
    },
}))

const { afterAll, beforeAll, describe, expect, it } = await import('vitest')
const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { createServer } = await import('../http/server.js')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { getRun } = await import('../db/repos/runs.js')
const { getSession } = await import('../db/repos/sessions.js')
const { readCheckinLog } = await import('./log.js')
const { CHECKIN_FALLBACK_INSTRUCTIONS } = await import('./brief.js')
const { workspaceDir } = await import('../config/paths.js')
const { touchMember } = await import('../db/repos/members.js')
const { announcePendingCheckins } = await import('./settle.js')
const { startScriptedModel } = await import('../remote/__fixtures__/scripted-model.mjs')

// A check-in on the fallback brief, with a model that tries to write a file through the shell first.
const SNEAKED = resolve(workspaceDir(FOREMAN_AGENT_ID), 'sneaked.txt')
const app = createServer()
let model: Awaited<ReturnType<typeof startScriptedModel>>

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeAll(async () => {
    await migrate()
    await ensureForeman()
    model = await startScriptedModel(({ last, lastText }) => {
        if (script.mode === 'speak') {
            if (last?.role === 'tool' && lastText.includes('Noted')) return { text: 'Your invoices coworker failed three nights in a row: its Stripe sign-in expired.\n\n<quick_replies>\nReconnect Stripe\nShow me the runs\n</quick_replies>' }
            return { toolCalls: [{ name: 'report_to_member', arguments: { member: 'u-ana', about: ['agent-invoices'], title: 'Invoices keep failing' } }] }
        }
        if (last?.role === 'tool') return { text: 'Nothing worth a message today.' }
        return { toolCalls: [{ name: 'shell_exec', arguments: { command: `echo pwned > ${SNEAKED}` } }] }
    })
    const connection = (await (await send('POST', '/connections', { name: 'Scripted', provider: 'custom', baseUrl: model.url, models: ['scripted'] })).json()) as { id: string }
    expect((await send('PATCH', `/agents/${FOREMAN_AGENT_ID}`, { connectionId: connection.id, provider: 'custom', model: 'scripted' })).status).toBe(200)
}, 30_000)

afterAll(async () => {
    await model.close()
})

describe('a check-in of the Chief of Staff', () => {
    let runId = ''
    let sessionId = ''

    it('starts on demand, in a session nobody is told about', async () => {
        sent.length = 0
        const res = await send('POST', `/agents/${FOREMAN_AGENT_ID}/checkins/run`)
        expect(res.status).toBe(202)
        ;({ runId, sessionId } = (await res.json()) as { runId: string; sessionId: string })
        await expect.poll(async () => (await getRun(FOREMAN_AGENT_ID, runId))?.status, { timeout: 15_000 }).toBe('done')
        expect((await getSession(FOREMAN_AGENT_ID, sessionId))?.source).toBe('schedule')
        expect((await getRun(FOREMAN_AGENT_ID, runId))?.triggerSource).toBe('checkin')
    }, 30_000)

    it('is handed only tools that read, and the shell it reached for is not one of them', () => {
        const first = model.calls[0]
        expect(first.tools).toEqual(expect.arrayContaining(['fs_read', 'web_fetch', 'schedule_list']))
        for (const name of ['shell_exec', 'fs_write', 'delegate_tasks', 'ask_user', 'schedule_create', 'memory_write']) expect(first.tools).not.toContain(name)
        expect(existsSync(SNEAKED)).toBe(false)
    })

    it('runs on the fallback charter when the hub has no brief to hand', () => {
        expect(JSON.stringify(model.calls[0].messages[0])).toContain(CHECKIN_FALLBACK_INSTRUCTIONS.slice(0, 80))
    })

    it('ends without a word to the hub, its conclusion kept in its log', async () => {
        expect(sent).toEqual([])
        expect(await readCheckinLog(runId)).toEqual({ reason: 'manual', note: 'Nothing worth a message today.' })
    })

    it('tells the hub of a check-in that spoke: the thread first, then the end of its run', async () => {
        script.mode = 'speak'
        sent.length = 0
        await touchMember({ id: 'u-ana', name: 'Ana', timezone: 'Europe/Paris' })
        const started = (await (await send('POST', `/agents/${FOREMAN_AGENT_ID}/checkins/run`)).json()) as { runId: string; sessionId: string }
        await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(2)
        expect(sent.map(event => event.event)).toEqual(['agent.session.created', 'agent.schedule.completed'])
        expect(sent[0]).toMatchObject({ agentId: FOREMAN_AGENT_ID, sessionId: started.sessionId, runId: started.runId, title: 'Invoices keep failing', message: 'Your invoices coworker failed three nights in a row: its Stripe sign-in expired.', source: 'schedule', metadata: { checkin: { reason: 'manual' }, memberId: 'u-ana', aboutAgentIds: ['agent-invoices'] } })
        expect(await readCheckinLog(started.runId)).toMatchObject({ reportedTo: 'u-ana', title: 'Invoices keep failing', announcedAt: expect.any(String) })
        expect(JSON.stringify(model.calls.at(-2)?.messages)).toContain('Ana (id u-ana)')
    }, 30_000)

    it('tries the thread again on a later tick when the hub did not hear it, never the end alone', async () => {
        hub.down = true
        sent.length = 0
        const started = (await (await send('POST', `/agents/${FOREMAN_AGENT_ID}/checkins/run`)).json()) as { runId: string }
        await expect.poll(async () => (await getRun(FOREMAN_AGENT_ID, started.runId))?.status, { timeout: 15_000 }).toBe('done')
        await expect.poll(async () => (await readCheckinLog(started.runId))?.title, { timeout: 5_000 }).toBe('Invoices keep failing')
        expect(sent).toEqual([])
        expect((await readCheckinLog(started.runId))?.announcedAt).toBeUndefined()
        hub.down = false
        await announcePendingCheckins()
        expect(sent.map(event => event.event)).toEqual(['agent.session.created', 'agent.schedule.completed'])
        await announcePendingCheckins()
        expect(sent).toHaveLength(2)
        script.mode = 'sneak'
    }, 30_000)

    it('lists them for the card, newest first, with when it next looks', async () => {
        const res = await send('GET', `/agents/${FOREMAN_AGENT_ID}/checkins`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { proactive: unknown; available: boolean; checkins: Array<{ reason: string; note?: string; title?: string }>; nextAt: string | null }
        expect(body.proactive).toEqual({ enabled: true, connectionId: null, model: null })
        expect(body.available).toBe(true)
        expect(body.checkins).toHaveLength(3)
        expect(body.checkins.at(-1)).toMatchObject({ reason: 'manual', note: 'Nothing worth a message today.' })
        expect(body.checkins[0]).toMatchObject({ reason: 'manual', title: 'Invoices keep failing' })
        expect(Number.isNaN(Date.parse(body.nextAt ?? ''))).toBe(false)
        expect((await send('GET', '/agents/someone/checkins')).status).toBe(404)
    })

    it('refuses to start once an admin switched them off', async () => {
        expect((await send('PATCH', `/agents/${FOREMAN_AGENT_ID}`, { proactive: { enabled: false } })).status).toBe(200)
        expect((await send('POST', `/agents/${FOREMAN_AGENT_ID}/checkins/run`)).status).toBe(403)
        expect((await send('PATCH', `/agents/${FOREMAN_AGENT_ID}`, { proactive: { enabled: true } })).status).toBe(200)
    })

    it('keeps its switch across a reboot, which rewrites the rest of the foreman from code', async () => {
        await send('PATCH', `/agents/${FOREMAN_AGENT_ID}`, { proactive: { enabled: false, connectionId: null, model: 'scripted' } })
        await ensureForeman()
        const agent = (await (await send('GET', `/agents/${FOREMAN_AGENT_ID}`)).json()) as { config: { proactive: unknown } }
        expect(agent.config.proactive).toEqual({ enabled: false, connectionId: null, model: 'scripted' })
    })

    it('has no check-ins on any other coworker', async () => {
        expect((await send('POST', '/agents/someone/checkins/run')).status).toBe(404)
    })
})
