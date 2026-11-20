import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-loop-labels-'))

const { opts } = vi.hoisted(() => ({ opts: { calls: [] as Array<{ labels?: Record<string, string> }> } }))

vi.mock('../tools/registry.js', () => ({
    buildTools: async () => {
        return { tools: {}, close: async () => {} }
    },
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: (...args: unknown[]) => {
            opts.calls.push(args[4] as { labels?: Record<string, string> })
            return {
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
            }
        },
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
const { runAgent } = await import('./loop.js')

const id = 'labelsagent'

type Trigger = Parameters<typeof runAgent>[6]

async function runWith(message: string, trigger: Trigger) {
    const session = await createSession(id, message)
    const agent = await getAgent(id)
    const run = await runAgent(agent, session.id, message, undefined, undefined, undefined, trigger)
    await run.settled
    return { run, sessionId: session.id }
}

describe('run labels', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'labels' }))
    })

    afterEach(() => {
        opts.calls = []
    })

    it('passes the run id and session to resolveModel', async () => {
        const { run, sessionId } = await runWith('hello', { source: 'chat' })
        const labels = opts.calls[0]?.labels
        expect(labels?.RERUN_RUN_ID).toBe(run.runId)
        expect(labels?.RERUN_SESSION_ID).toBe(sessionId)
        expect(labels?.RERUN_COWORKER_ID).toBe(id)
    })

    it('has no RERUN_JOB on a run without lineage', async () => {
        await runWith('hello', { source: 'chat' })
        expect(opts.calls[0]?.labels).toBeDefined()
        expect(opts.calls[0]?.labels).not.toHaveProperty('RERUN_JOB')
    })

    it('reads job and branch from the run lineage', async () => {
        await runWith('hello', { source: 'chat', lineage: { jobRef: 'rerun#7', branch: 'job/7' } })
        expect(opts.calls[0]?.labels?.RERUN_JOB).toBe('rerun#7')
        expect(opts.calls[0]?.labels?.RERUN_BRANCH).toBe('job/7')
    })

    it('reads the copy number from the run lineage', async () => {
        await runWith('hello', { source: 'chat', lineage: { copyIndex: 2 } })
        expect(opts.calls[0]?.labels?.RERUN_COPY).toBe('2')
    })
})
