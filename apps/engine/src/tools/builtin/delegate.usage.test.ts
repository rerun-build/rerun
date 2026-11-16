import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-delegate-usage-'))
process.env.RERUN_API_KEY = ''

type Child = { id: string; config: any }

const fake = vi.hoisted(() => ({ error: undefined as string | undefined, count: 0 }))

vi.mock('../../runtime/loop.js', async () => {
    const { startRun, finishRun } = await import('../../db/repos/runs.js')
    const { insertRunStep } = await import('../../db/repos/telemetry.js')
    return {
        runAgent: async (child: Child, sessionId: string) => {
            fake.count += 1
            const runId = `child-run-${fake.count}`
            await startRun(child.id, sessionId, runId)
            await insertRunStep(child.id, {
                id: `step-${fake.count}`,
                runId,
                agentId: child.id,
                sessionId,
                stepNumber: 1,
                provider: child.config.provider,
                model: child.config.model,
                finishReason: 'stop',
                inputTokens: 1000,
                outputTokens: 50,
                cachedInputTokens: 900,
                reasoningTokens: null,
                totalTokens: 1050,
                cacheWriteTokens: null,
                costMicros: null,
                effort: child.config.thinkingLevel ?? null,
                toolCallCount: 0,
                textLength: 4,
                durationMs: 10,
                createdAt: new Date().toISOString(),
            })
            await finishRun(child.id, runId, { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 900, totalTokens: 1050 }, 1)
            async function* stream() {
                if (fake.error) yield { type: 'error', error: new Error(fake.error) }
                yield { type: 'text-delta', text: 'done' }
                yield { type: 'finish-step' }
            }
            return { runId, result: { fullStream: stream() }, settled: Promise.resolve() }
        },
    }
})

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { migrate } = await import('../../db/migrate.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { listRunSteps } = await import('../../db/repos/telemetry.js')
const { plusDelegated } = await import('../../runtime/delegated-usage.js')
const { delegateTools } = await import('./delegate.js')

function ctxWith() {
    const config = agentConfigSchema.parse({ name: 'boss', model: null })
    return {
        agent: { id: 'boss', config, soul: 'Boss soul', install: '', env: {}, resolved: { connection: { id: 'conn-1', config: { models: ['acme/small'], extraModels: [] } } } },
        sessionId: 's',
        runId: 'parent-run',
        logger: { warn() {}, info() {}, error() {}, debug() {} },
        provider: 'openrouter',
        model: 'acme/large',
        delegated: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    } as any
}

async function delegate(ctx: any, tasks: Array<Record<string, unknown>>): Promise<string> {
    return (await (delegateTools(ctx).delegate_tasks as any).execute({ tasks }, { toolCallId: 'call-1', messages: [] })) as string
}

beforeAll(async () => {
    await migrate()
})

beforeEach(() => {
    fake.error = undefined
})

describe('delegated usage', () => {
    it('adds every child run tokens to the parent run', async () => {
        const ctx = ctxWith()
        await delegate(ctx, [{ task: 'a' }, { task: 'b' }])
        expect(ctx.delegated).toEqual({ inputTokens: 2000, outputTokens: 100, cachedInputTokens: 1800, reasoningTokens: 0, totalTokens: 2100 })
    })

    it('keeps each child step on the parent run with the child model and effort', async () => {
        const ctx = ctxWith()
        ctx.runId = 'parent-run-steps'
        await delegate(ctx, [{ task: 'a', model: 'acme/small', thinkingLevel: 'low' }])
        const steps = await listRunSteps('boss', 'parent-run-steps')
        expect(steps).toHaveLength(1)
        expect(steps[0]).toMatchObject({ agentId: 'boss', runId: 'parent-run-steps', model: 'acme/small', effort: 'low', inputTokens: 1000, outputTokens: 50, cachedInputTokens: 900 })
    })

    it('counts a child whose stream failed', async () => {
        fake.error = 'boom'
        const ctx = ctxWith()
        await delegate(ctx, [{ task: 'a' }])
        expect(ctx.delegated.inputTokens).toBe(1000)
    })

    it('sums the parent usage and the delegated usage', () => {
        const own = { inputTokens: 10, outputTokens: 2, cachedInputTokens: 5, totalTokens: 12 }
        expect(plusDelegated(own, { inputTokens: 2000, outputTokens: 100, cachedInputTokens: 1800, reasoningTokens: 0, totalTokens: 2100 })).toMatchObject({ inputTokens: 2010, outputTokens: 102, cachedInputTokens: 1805, reasoningTokens: 0, totalTokens: 2112 })
        expect(plusDelegated(own, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 0 })).toBe(own)
        expect(plusDelegated(own, undefined)).toBe(own)
    })
})
