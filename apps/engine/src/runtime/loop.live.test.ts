import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-live-'))

const { stream, seen } = vi.hoisted(() => ({
    stream: { parts: [] as unknown[], hang: false },
    seen: { beforeFinish: undefined as number | undefined },
}))

vi.mock('../tools/registry.js', () => ({
    buildTools: async () => ({ tools: {}, close: async () => {} }),
}))

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
                            for (const part of stream.parts) controller.enqueue(part)
                            if (!stream.hang) controller.close()
                        },
                    }),
                }),
            }),
            close: async () => {},
        }),
    }
})

vi.mock('./notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./notify.js')>()),
    sendNotification: async () => ({ delivered: true }),
}))

vi.mock('../db/repos/runs.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../db/repos/runs.js')>()
    return {
        ...actual,
        finishRun: async (...args: Parameters<typeof actual.finishRun>) => {
            seen.beforeFinish = (await actual.getRun(args[0], args[1]))?.stepCount
            return actual.finishRun(...args)
        },
    }
})

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { getRun } = await import('../db/repos/runs.js')
const { insertAgentIndex } = await import('../db/repos/agents.js')
const { listToolCalls } = await import('../db/repos/telemetry.js')
const { runAgent } = await import('./loop.js')
const { abortRun } = await import('./run-control.js')
const { reconcileInterruptedRuns } = await import('./reconcile.js')

const toolCall = (n: number): unknown => ({ type: 'tool-call', toolCallId: `c${n}`, toolName: 'Read', input: '{}', providerExecuted: true, dynamic: true })
const toolResult = (n: number): unknown => ({ type: 'tool-result', toolCallId: `c${n}`, toolName: 'Read', result: 'ok', providerExecuted: true, dynamic: true })

const turn = (calls: number): unknown[] => [
    { type: 'stream-start', warnings: [] },
    ...Array.from({ length: calls }, (_, i) => [toolCall(i), toolResult(i)]).flat(),
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'done' },
    { type: 'text-end', id: '0' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
]

async function run(id: string, calls: number, override?: { provider: 'claude' }) {
    stream.parts = turn(calls)
    seen.beforeFinish = undefined
    const session = await createSession(id, 'go')
    const agent = await getAgent(id)
    const started = await runAgent(agent, session.id, 'go', override, undefined, undefined, { source: 'chat' })
    await started.settled
    return getRun(id, started.runId)
}

describe('live step count of a CLI run', () => {
    beforeAll(async () => {
        await migrate()
        for (const [id, provider] of [['liveclaude', 'claude'], ['liveapi', 'anthropic']] as const) {
            await mkdir(agentDir(id), { recursive: true })
            await writeAgentConfig(id, agentConfigSchema.parse({ name: id, provider }))
            await insertAgentIndex(id, id)
        }
    })

    it('holds the tool-call count before the run settles and after', async () => {
        const row = await run('liveclaude', 5, { provider: 'claude' })
        expect(seen.beforeFinish).toBe(5)
        expect(row?.stepCount).toBe(5)
        expect(await listToolCalls('liveclaude', row?.id ?? '')).toHaveLength(5)
    })

    it('leaves a provider that reports real steps counting steps', async () => {
        const row = await run('liveapi', 5)
        expect(seen.beforeFinish).toBe(1)
        expect(row?.stepCount).toBe(1)
    })
})

describe('a CLI run cut by an engine restart', () => {
    it('keeps the tool calls it made before the cut', async () => {
        stream.parts = turn(3).slice(0, 7)
        stream.hang = true
        const session = await createSession('liveclaude', 'cut')
        const agent = await getAgent('liveclaude')
        const started = await runAgent(agent, session.id, 'go', { provider: 'claude' }, undefined, undefined, { source: 'chat' })
        await vi.waitFor(async () => expect((await getRun('liveclaude', started.runId))?.stepCount).toBe(3), { timeout: 5000 })

        await reconcileInterruptedRuns()

        const row = await getRun('liveclaude', started.runId)
        expect(row?.error).toBe('interrupted: engine restarted')
        const tools = await listToolCalls('liveclaude', started.runId)
        expect(tools.map(tool => [tool.toolCallId, tool.resultJson, tool.isError])).toEqual([['c0', '"ok"', 0], ['c1', '"ok"', 0], ['c2', '"ok"', 0]])
        stream.hang = false
        abortRun(started.runId)
    })
})
