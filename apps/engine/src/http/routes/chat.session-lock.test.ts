import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-session-lock-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { createSession } = await import('../../db/repos/sessions.js')
const { claimSession, releaseSession, registerRunAbort, unregisterRunAbort } = await import('../../runtime/run-control.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir } = await import('../../config/paths.js')

const id = 'lockagent'

describe('one live run per session', () => {
    beforeAll(async () => {
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'lock' }))
    })

    it('hands the claim to the first caller and names the holder to the second', () => {
        expect(claimSession('sess-a', 'run-1')).toBeNull()
        expect(claimSession('sess-a', 'run-2')).toBe('run-1')
        releaseSession('run-1')
        expect(claimSession('sess-a', 'run-2')).toBeNull()
        releaseSession('run-2')
    })

    // The claim is taken in the route but freed by the run loop, which only ever unregisters the
    // abort controller. If the two ever drift apart, a finished run keeps its session locked forever.
    it('frees the session when the run unregisters its abort controller', () => {
        expect(claimSession('sess-b', 'run-3')).toBeNull()
        registerRunAbort('run-3', 'agent-1')
        unregisterRunAbort('run-3')
        expect(claimSession('sess-b', 'run-4')).toBeNull()
        releaseSession('run-4')
    })

    it('refuses a second chat on a session that already has a run in flight', async () => {
        const session = await createSession(id, 'locked')
        expect(claimSession(session.id, 'run-in-flight')).toBeNull()

        const app = createServer()
        const res = await app.request(`/agents/${id}/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: session.id, message: 'answering the same question twice' }),
        })

        expect(res.status).toBe(409)
        // `code` and `startedAt` are what let the dashboard offer to stop the run instead of
        // showing a dead end the user cannot act on.
        const body = (await res.json()) as { code?: string; startedAt?: string }
        expect(body).toMatchObject({ code: 'run_in_flight', runId: 'run-in-flight', sessionId: session.id })
        expect(Number.isNaN(Date.parse(body.startedAt ?? ''))).toBe(false)

        releaseSession('run-in-flight')
    })

    it('answers 404 on a message to replace that is not in the conversation, and frees the session', async () => {
        const session = await createSession(id, 'replace')
        const app = createServer()
        const send = () =>
            app.request(`/agents/${id}/chat`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: session.id, message: 'edited', replaceFrom: 'not-a-message' }),
            })
        const res = await send()
        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({ code: 'message_not_found' })
        expect((await send()).status).toBe(404)
    })
})
