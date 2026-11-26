import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-sessions-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll, afterAll, vi } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { createSession, touchSession } = await import('../../db/repos/sessions.js')
const { appendMessage } = await import('../../db/repos/messages.js')
const { claimSession, releaseSession } = await import('../../runtime/run-control.js')

const id = 'sessionagent'
const app = createServer()

type Session = { id: string; title: string; source: string; agentId: string }

async function listed(): Promise<Session[]> {
    const res = await app.request(`/agents/${id}/sessions`)
    expect(res.status).toBe(200)
    return ((await res.json()) as { sessions: Session[] }).sessions
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'sessions' }))
})

describe('GET /agents/:id/sessions', () => {
    const titles: Record<string, string> = {}

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))
        titles.oldest = (await createSession(id, 'oldest chat')).id
        vi.setSystemTime(new Date('2026-03-01T11:00:00.000Z'))
        titles.digest = (await createSession(id, 'schedule: daily-digest', undefined, 'schedule')).id
        vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'))
        titles.report = (await createSession(id, 'schedule: weekly-report', undefined, 'schedule')).id
        vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z'))
        titles.newest = (await createSession(id, 'newest chat')).id
    })

    afterAll(() => {
        vi.useRealTimers()
    })

    it('lists every session, most recently active first', async () => {
        expect((await listed()).map(s => s.id)).toEqual([titles.newest, titles.report, titles.digest, titles.oldest])
    })

    it('moves a session up when it is touched', async () => {
        vi.setSystemTime(new Date('2026-03-01T14:00:00.000Z'))
        await touchSession(id, titles.oldest)
        expect((await listed())[0].id).toBe(titles.oldest)
    })
})

describe('GET /agents/:id/sessions/:sid', () => {
    it('returns the session', async () => {
        const session = await createSession(id, 'single')
        const res = await app.request(`/agents/${id}/sessions/${session.id}`)
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ id: session.id, title: 'single', agentId: id })
    })

    it('404s on a session of another agent or none at all', async () => {
        const foreign = await createSession('otheragent', 'not yours')
        expect((await app.request(`/agents/${id}/sessions/${foreign.id}`)).status).toBe(404)
        const res = await app.request(`/agents/${id}/sessions/nope`)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'session not found' })
    })
})

describe('GET /agents/:id/sessions/:sid/messages', () => {
    it('returns the messages of the session in order', async () => {
        const session = await createSession(id, 'talk')
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-03-02T10:00:01.000Z'))
        await appendMessage(id, session.id, { role: 'assistant', content: 'second' })
        vi.setSystemTime(new Date('2026-03-02T10:00:00.000Z'))
        await appendMessage(id, session.id, { role: 'user', content: 'first' })
        vi.useRealTimers()
        const res = await app.request(`/agents/${id}/sessions/${session.id}/messages`)
        expect(res.status).toBe(200)
        const { messages } = (await res.json()) as { messages: { role: string; contentJson: string }[] }
        expect(messages.map(m => [m.role, JSON.parse(m.contentJson)])).toEqual([
            ['user', 'first'],
            ['assistant', 'second'],
        ])
    })

    it('404s on a session that belongs to another agent', async () => {
        const foreign = await createSession('otheragent', 'not yours')
        const res = await app.request(`/agents/${id}/sessions/${foreign.id}/messages`)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'session not found' })
    })

    it('404s on a session that does not exist', async () => {
        expect((await app.request(`/agents/${id}/sessions/nope/messages`)).status).toBe(404)
    })
})

describe('DELETE /agents/:id/sessions/:sid/messages/:mid', () => {
    async function remove(sid: string, mid: string) {
        return app.request(`/agents/${id}/sessions/${sid}/messages/${mid}`, { method: 'DELETE' })
    }

    it('deletes the message and names what went', async () => {
        const session = await createSession(id, 'delete')
        const ask = await appendMessage(id, session.id, { role: 'user', content: 'typo' })
        const reply = await appendMessage(id, session.id, { role: 'assistant', content: 'answer' })
        const res = await remove(session.id, ask.id)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deletedIds: [ask.id] })
        const { messages } = (await (await app.request(`/agents/${id}/sessions/${session.id}/messages`)).json()) as { messages: { id: string }[] }
        expect(messages.map(m => m.id)).toEqual([reply.id])
    })

    it('refuses while a run holds the conversation, and leaves the session free after', async () => {
        const session = await createSession(id, 'busy')
        const ask = await appendMessage(id, session.id, { role: 'user', content: 'hello' })
        expect(claimSession(session.id, 'run-busy')).toBeNull()
        const busy = await remove(session.id, ask.id)
        expect(busy.status).toBe(409)
        expect(await busy.json()).toMatchObject({ code: 'run_in_flight' })
        releaseSession('run-busy')
        expect((await remove(session.id, ask.id)).status).toBe(200)
        expect(claimSession(session.id, 'run-after')).toBeNull()
        releaseSession('run-after')
    })

    it('404s on an unknown message or a session of another agent', async () => {
        const session = await createSession(id, 'missing')
        expect((await remove(session.id, 'nope')).status).toBe(404)
        const foreign = await createSession('otheragent', 'not yours')
        const theirs = await appendMessage('otheragent', foreign.id, { role: 'user', content: 'mine' })
        expect((await remove(foreign.id, theirs.id)).status).toBe(404)
    })
})
