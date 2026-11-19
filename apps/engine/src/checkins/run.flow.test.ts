import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-checkin-flow-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_DESKTOP = 'off'

const { sent } = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }))

vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
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
const { startScriptedModel } = await import('../remote/__fixtures__/scripted-model.mjs')

// A check-in on the fallback brief, with a model that tries to write a file through the shell first.
const SNEAKED = resolve(workspaceDir(FOREMAN_AGENT_ID), 'sneaked.txt')
const app = createServer()
let model: Awaited<ReturnType<typeof startScriptedModel>>

const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeAll(async () => {
    await migrate()
    await ensureForeman()
    model = await startScriptedModel(({ last }) => {
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
