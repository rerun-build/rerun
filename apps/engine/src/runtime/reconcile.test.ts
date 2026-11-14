import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-reconcile-'))

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

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { insertAgentIndex } = await import('../db/repos/agents.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun, startRun } = await import('../db/repos/runs.js')
const { reconcileInterruptedRuns } = await import('./reconcile.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { FOREMAN_AGENT_ID } = await import('@rerun/contracts')
const { getSkillProposal, insertSkillProposal, transitionSkillProposal } = await import('../db/repos/skill-proposals.js')
const { getSystemDb } = await import('../db/systemDb.js')
const { runs } = await import('../db/schema.js')
const { eq } = await import('drizzle-orm')

const id = 'restartagent'

async function backdate(runId: string, startedAt: string): Promise<void> {
    const { db } = await getSystemDb(id)
    await db.update(runs).set({ startedAt }).where(eq(runs.id, runId))
}

describe('reconcileInterruptedRuns', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'restart' }))
        await insertAgentIndex(id, 'restart')
    })

    beforeEach(() => {
        sent.length = 0
    })

    it('fails the runs a restart interrupted and tells the hub about each one', async () => {
        const session = await createSession(id, 'interrupted')
        const run = await startRun(id, session.id)

        const result = await reconcileInterruptedRuns()

        expect(result.runs).toBe(1)
        expect(result.notified).toBe(1)
        const row = await getRun(id, run.id)
        expect(row?.status).toBe('error')
        expect(row?.error).toBe('interrupted: engine restarted')
        const completion = sent.find(n => n.runId === run.id)
        expect(completion?.kind).toBe('error')
        expect((completion?.metadata as Record<string, unknown>).errorCode).toBe('engine_restarted')
    })

    it('repairs an old run without announcing it', async () => {
        const session = await createSession(id, 'ancient')
        const run = await startRun(id, session.id)
        await backdate(run.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

        const result = await reconcileInterruptedRuns()

        expect(result.runs).toBe(1)
        expect(result.notified).toBe(0)
        expect((await getRun(id, run.id))?.status).toBe('error')
        expect(sent).toHaveLength(0)
    })

    it('fails the runs a restart caught on the foreman too', async () => {
        await ensureForeman()
        const session = await createSession(FOREMAN_AGENT_ID, 'foreman')
        const run = await startRun(FOREMAN_AGENT_ID, session.id)

        const result = await reconcileInterruptedRuns()

        expect(result.runs).toBe(1)
        expect((await getRun(FOREMAN_AGENT_ID, run.id))?.status).toBe('error')
    })

    it('does nothing when no run was in flight', async () => {
        expect(await reconcileInterruptedRuns()).toMatchObject({ runs: 0, notified: 0, proposals: 0 })
        expect(sent).toHaveLength(0)
    })

    it('fails the skill proposal a restart caught being written, and leaves the others alone', async () => {
        const session = await createSession(id, 'writing')
        const base = { sessionId: session.id, runId: null, mode: 'create' as const, slug: null, title: 'Weekly report', summary: 'How it goes out', instruction: 'Send it Monday.' }
        const writing = await insertSkillProposal(id, { ...base, toolCallId: 'call-writing', fingerprint: 'fp-writing' })
        await transitionSkillProposal(id, writing.id, ['proposed'], 'accepted')
        const waiting = await insertSkillProposal(id, { ...base, toolCallId: 'call-waiting', fingerprint: 'fp-waiting' })

        const result = await reconcileInterruptedRuns()

        expect(result.proposals).toBe(1)
        const failed = await getSkillProposal(id, writing.id)
        expect(failed?.status).toBe('failed')
        expect(failed?.error).toBe('interrupted: engine restarted')
        expect((await getSkillProposal(id, waiting.id))?.status).toBe('proposed')
    })
})
