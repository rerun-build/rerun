import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cancel-session-'))
process.env.RERUN_API_KEY = ''

vi.mock('../../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../runtime/notify.js')>()),
    sendNotification: async () => ({ delivered: true }),
}))

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')
const { createSession } = await import('../../db/repos/sessions.js')
const { getRun, startRun } = await import('../../db/repos/runs.js')
const { claimSession, registerRunAbort, releaseSession, sessionClaim } = await import('../../runtime/run-control.js')

const id = 'cancelsession'
const app = createServer()
const cancel = (rid: string) => app.request(`/agents/${id}/runs/${rid}/cancel`, { method: 'POST' })

describe('a cancelled run frees its session for the next message', () => {
    beforeAll(async () => {
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'cancel session' }))
    })

    it('a live run: cancelled, and the session takes a new message', async () => {
        const session = await createSession(id, 'live')
        const run = await startRun(id, session.id)
        expect(claimSession(session.id, run.id)).toBeNull()
        registerRunAbort(run.id, id)
        expect(await (await cancel(run.id)).json()).toEqual({ ok: true, aborted: true })
        expect((await getRun(id, run.id))?.status).toBe('cancelled')
        expect(sessionClaim(session.id)).toBeNull()
        expect(claimSession(session.id, 'next-live')).toBeNull()
        releaseSession('next-live')
    })

    it('a run with no live loop: cancelled, and the session takes a new message', async () => {
        const session = await createSession(id, 'orphan')
        const run = await startRun(id, session.id)
        expect(claimSession(session.id, run.id)).toBeNull()
        expect(await (await cancel(run.id)).json()).toEqual({ ok: true, aborted: false })
        expect((await getRun(id, run.id))?.status).toBe('cancelled')
        expect(sessionClaim(session.id)).toBeNull()
        expect(claimSession(session.id, 'next-orphan')).toBeNull()
        releaseSession('next-orphan')
    })
})
