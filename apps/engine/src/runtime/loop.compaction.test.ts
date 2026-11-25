import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-loop-compaction-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

// Each `dump` result is ~25k estimated tokens against a 60k threshold: the run crosses it on its
// third result, while the tail of 20k can only hold the latest step.
const DUMP_CHARS = 100_000

const { stream, summaries } = vi.hoisted(() => ({
    stream: { turns: [] as unknown[][], calls: [] as Array<Record<string, unknown>> },
    summaries: [] as string[],
}))

vi.mock('./notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./notify.js')>()),
    sendNotification: async () => ({ delivered: true }),
}))

vi.mock('./curator.js', () => ({ runCurator: async () => {} }))

vi.mock('./compaction/compact.js', async importOriginal => ({
    ...(await importOriginal<typeof import('./compaction/compact.js')>()),
    runContextWindow: () => 80_000,
}))

vi.mock('../tools/registry.js', async () => {
    const { tool } = await import('ai')
    const { z } = await import('zod')
    let calls = 0
    const dump = tool({ description: 'dump', inputSchema: z.object({}), execute: async () => `DUMP-${++calls}`.padEnd(DUMP_CHARS, '.') })
    return { buildTools: async () => ({ tools: { dump }, close: async () => {} }) }
})

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    const { wrapLanguageModel } = await import('ai')
    const { createQuickRepliesCapture } = await import('../agents/quick-replies-stream.js')
    return {
        ...actual,
        modelFor: () =>
            new MockLanguageModelV3({
                doGenerate: async options => {
                    summaries.push(JSON.stringify(options.prompt))
                    return {
                        content: [{ type: 'text', text: '## Historical Task Snapshot\nRUN SUMMARY' }],
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: { inputTokens: { total: 700, noCache: 700, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } },
                        warnings: [],
                        providerMetadata: { openrouter: { usage: { cost: 0.002 } } },
                    }
                },
            }),
        resolveModel: () => {
            const replies = createQuickRepliesCapture()
            const model = new MockLanguageModelV3({
                doStream: async options => {
                    stream.calls.push(options as Record<string, unknown>)
                    const parts = stream.turns.shift() ?? []
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                for (const part of parts) controller.enqueue(part)
                                controller.close()
                            },
                        }),
                    }
                },
            })
            return { model: wrapLanguageModel({ model, middleware: [replies.middleware] }), close: async () => {}, quickReplies: replies.read }
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
const { listMessages } = await import('../db/repos/messages.js')
const { listRunSteps } = await import('../db/repos/telemetry.js')
const { getRun } = await import('../db/repos/runs.js')
const { runAgent } = await import('./loop.js')
const { IN_RUN_SUMMARY_PREAMBLE } = await import('./compaction/in-run.js')

const id = 'compactagent'
const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } }

function dumpTurn(toolCallId: string): unknown[] {
    return [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId, toolName: 'dump', input: '{}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
    ]
}

function reasonedDumpTurn(toolCallId: string): unknown[] {
    const [start, call, finish] = dumpTurn(toolCallId)
    return [
        start,
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: `thought of ${toolCallId}` },
        { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: `signed-${toolCallId}` } } },
        call,
        finish,
    ]
}

function textTurn(text: string): unknown[] {
    return [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: text },
        { type: 'text-end', id: '0' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ]
}

type PromptMessage = { role: string; content: unknown }

describe('compaction in the middle of a run', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'compact', selfImprovement: { enabled: false } }))
    })

    it('sends the later steps the summary, the request and the latest step, and still stores the whole run', async () => {
        stream.turns = [dumpTurn('call-1'), dumpTurn('call-2'), dumpTurn('call-3'), textTurn('All dumped.')]
        const session = await createSession(id, 'dump everything')
        const started = await runAgent(await getAgent(id), session.id, 'dump everything')

        expect(await started.settled).toEqual({ kind: 'done' })
        expect(stream.calls).toHaveLength(4)
        expect(summaries).toHaveLength(1)
        expect(summaries[0]).toContain('dump everything')
        expect(summaries[0]).toContain('← dump result: DUMP-1')
        expect(summaries[0]).not.toContain('[pruned]')

        expect(JSON.stringify(stream.calls[2].prompt)).toContain('DUMP-1')
        const fourth = (stream.calls[3].prompt as PromptMessage[]).filter(message => message.role !== 'system')
        expect(JSON.stringify(fourth[0])).toContain(IN_RUN_SUMMARY_PREAMBLE)
        expect(JSON.stringify(fourth[0])).toContain('RUN SUMMARY')
        expect(JSON.stringify(fourth[1])).toContain('dump everything')
        expect(JSON.stringify(fourth)).toContain('DUMP-3')
        expect(JSON.stringify(fourth)).not.toContain('DUMP-1')
        expect(JSON.stringify(fourth)).not.toContain('DUMP-2')

        const stored = (await listMessages(id, session.id)).map(row => row.contentJson).join('\n')
        expect(stored).toContain('DUMP-1')
        expect(stored).toContain('DUMP-3')
        expect(stored).not.toContain('RUN SUMMARY')

        const steps = await listRunSteps(id, started.runId)
        expect(steps.filter(step => step.finishReason === 'compaction')).toEqual([expect.objectContaining({ stepNumber: 3, inputTokens: 700, outputTokens: 30, costMicros: 2000 })])

        // The steps of the mock model cost nothing: the run's cost is the summary's, its tokens are not.
        const run = await getRun(id, started.runId)
        expect(run?.costMicros).toBe(2000)
        expect(run?.inputTokens).toBe(12)
    })

    // RER-278: the Anthropic API refuses a thought whose start of conversation the summary replaced.
    it('replays no thought signed before the summary to Anthropic, and the later ones again', async () => {
        stream.turns = [reasonedDumpTurn('call-1'), reasonedDumpTurn('call-2'), reasonedDumpTurn('call-3'), reasonedDumpTurn('call-4'), textTurn('All dumped.')]
        stream.calls = []
        const session = await createSession(id, 'dump everything')
        const started = await runAgent(await getAgent(id), session.id, 'dump everything', { provider: 'anthropic', model: 'claude-sonnet-5-5' })

        expect(await started.settled).toEqual({ kind: 'done' })
        const [, , third, fourth, fifth] = stream.calls.map(call => JSON.stringify(call.prompt))
        expect(third).toContain('signed-call-2')
        expect(fourth).toContain(IN_RUN_SUMMARY_PREAMBLE)
        expect(fourth).toContain('DUMP-')
        expect(fourth).not.toContain('signed-call')
        expect(fifth).toContain('signed-call-4')
        expect(fifth).not.toContain('signed-call-3')

        const stored = (await listMessages(id, session.id)).map(row => row.contentJson).join('\n')
        for (const call of ['call-1', 'call-2', 'call-3', 'call-4']) expect(stored).toContain(`signed-${call}`)
    })
})
