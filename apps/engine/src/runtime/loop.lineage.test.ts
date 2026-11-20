import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-lineage-'))

const { seen, lineageWrite } = vi.hoisted(() => ({ seen: { lineage: undefined as unknown }, lineageWrite: { reject: false } }))

vi.mock('../tools/registry.js', () => ({
    buildTools: async (ctx: { lineage?: unknown }) => {
        seen.lineage = ctx.lineage
        return { tools: {}, close: async () => {} }
    },
}))

vi.mock('../db/repos/runs.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../db/repos/runs.js')>()
    return {
        ...actual,
        setRunLineage: (...args: Parameters<typeof actual.setRunLineage>) => (lineageWrite.reject ? Promise.reject(new Error('db down')) : actual.setRunLineage(...args)),
    }
})

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async () => ({
                    stream: new ReadableStream({
                        start(controller) {
                            for (const part of [
                                { type: 'stream-start', warnings: [] },
                                { type: 'text-start', id: '0' },
                                { type: 'text-delta', id: '0', delta: 'ok' },
                                { type: 'text-end', id: '0' },
                                { type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
                            ])
                                controller.enqueue(part)
                            controller.close()
                        },
                    }),
                }),
            }),
            close: async () => {},
        }),
    }
})

const { afterEach, beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun } = await import('../db/repos/runs.js')
const { runAgent } = await import('./loop.js')

const id = 'lineageagent'

type Trigger = Parameters<typeof runAgent>[6]

async function runWith(message: string, trigger: Trigger) {
    const session = await createSession(id, message)
    const agent = await getAgent(id)
    const run = await runAgent(agent, session.id, message, undefined, undefined, undefined, trigger)
    const outcome = await run.settled
    await new Promise(r => setTimeout(r, 100))
    return { run, outcome, row: await getRun(id, run.runId) }
}

describe('run lineage', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'lineage' }))
    })

    afterEach(() => {
        seen.lineage = undefined
        lineageWrite.reject = false
    })

    it('stores the author of a chat run as initiator_user_id', async () => {
        const { row } = await runWith('hello', { source: 'chat', author: { id: 'user-1', name: 'Rob' } })
        expect(row?.initiatorUserId).toBe('user-1')
        expect(row?.jobRef).toBeNull()
    })

    it('stores every field a trigger carries', async () => {
        const lineage = { initiatorAgentId: 'boss', initiatorRunId: 'run-9', initiatorSessionId: 'sess-9', initiatorUserId: 'user-2', jobRef: 'rerun#7', branch: 'job/7' }
        const { row } = await runWith('hello', { source: 'chat', lineage })
        expect(row?.initiatorAgentId).toBe('boss')
        expect(row?.initiatorRunId).toBe('run-9')
        expect(row?.initiatorSessionId).toBe('sess-9')
        expect(row?.initiatorUserId).toBe('user-2')
        expect(row?.jobRef).toBe('rerun#7')
        expect(row?.branch).toBe('job/7')
    })

    it('stores the copy number a trigger carries', async () => {
        const { row } = await runWith('hello', { source: 'chat', lineage: { copyIndex: 2 } })
        expect(row?.copyIndex).toBe(2)
    })

    it('takes the job ref from a JOB message and puts it on the context', async () => {
        const { row } = await runWith('JOB rerun#42\nbuild it', { source: 'chat', author: { id: 'user-1', name: 'Rob' } })
        expect(row?.jobRef).toBe('rerun#42')
        expect((seen.lineage as { jobRef?: string }).jobRef).toBe('rerun#42')
    })

    it('stores no lineage on a schedule run and keeps trigger_slug', async () => {
        const { row } = await runWith('tick', { source: 'schedule', slug: 'nightly', name: 'Nightly' })
        expect(row?.triggerSlug).toBe('nightly')
        expect(row?.initiatorUserId).toBeNull()
        expect(row?.jobRef).toBeNull()
        expect(row?.initiatorAgentId).toBeNull()
    })

    it('does not fail the run when the lineage write rejects', async () => {
        lineageWrite.reject = true
        const { outcome, row } = await runWith('JOB rerun#43', { source: 'chat', author: { id: 'user-1', name: 'Rob' } })
        expect(outcome.kind).toBe('done')
        expect(row?.status).toBe('done')
    })
})
