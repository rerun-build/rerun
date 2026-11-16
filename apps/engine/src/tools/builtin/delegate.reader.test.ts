import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-delegate-'))
process.env.RERUN_API_KEY = ''

type Child = { id: string; config: any; soul: string; env: Record<string, string> }
type Script = { text?: string; error?: string; throws?: string; gate?: Promise<void> }

const runs = vi.hoisted(() => ({
    started: [] as Array<{ child: Child; sessionId: string; prompt: string }>,
    script: (_prompt: string): Script => ({ text: 'done' }),
    active: 0,
    maxActive: 0,
    fourth: Promise.resolve(),
    onFourth: () => {},
}))

vi.mock('../../runtime/loop.js', () => ({
    runAgent: async (child: Child, sessionId: string, prompt: string) => {
        runs.started.push({ child, sessionId, prompt })
        if (runs.started.length === 4) runs.onFourth()
        const script = runs.script(prompt)
        if (script.throws) throw new Error(script.throws)
        runs.active += 1
        runs.maxActive = Math.max(runs.maxActive, runs.active)
        async function* stream() {
            try {
                await script.gate
                if (script.error) yield { type: 'error', error: new Error(script.error) }
                if (script.text) yield { type: 'text-delta', text: script.text }
                yield { type: 'finish-step' }
            } finally {
                runs.active -= 1
            }
        }
        return { runId: `run-${runs.started.length}`, result: { fullStream: stream() }, settled: Promise.resolve() }
    },
}))

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { migrate } = await import('../../db/migrate.js')
const { listAgentIndex } = await import('../../db/repos/agents.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { agentDir } = await import('../../config/paths.js')
const { delegateTools } = await import('./delegate.js')

type Written = { type: string; id: string; data: { tasks: Array<{ status: string; title: string }> } }

function ctxWith(extra: Record<string, unknown> = {}) {
    const writes: Written[] = []
    const partialResults: Array<{ label: string; text: string }> = []
    const config = agentConfigSchema.parse({ name: 'boss', model: null, tools: { cards: true, askUser: true }, selfImprovement: { enabled: true } })
    const ctx = {
        agent: { id: 'boss', config, soul: 'Boss soul', install: '', env: { API_KEY: 'k' }, resolved: { connection: { id: 'conn-1', config: { models: ['acme/large', 'acme/small'], extraModels: [] } } } },
        sessionId: 's',
        logger: { warn() {}, info() {}, error() {}, debug() {} },
        provider: 'openrouter',
        model: 'acme/large',
        writer: { write: (part: Written) => writes.push(part) },
        partialResults,
        ...extra,
    } as any
    return { ctx, writes, partialResults }
}

async function delegate(ctx: any, tasks: Array<Record<string, unknown>>, abortSignal?: AbortSignal): Promise<string> {
    return (await (delegateTools(ctx).delegate_tasks as any).execute({ tasks }, { toolCallId: 'call-1', messages: [], abortSignal })) as string
}

beforeAll(async () => {
    await migrate()
})

beforeAll(async () => {
    await migrate()
})

beforeEach(() => {
    runs.started.length = 0
    runs.script = () => ({ text: 'done' })
    runs.active = 0
    runs.maxActive = 0
    runs.fourth = new Promise<void>(resolve => (runs.onFourth = resolve))
})

describe('delegate_tasks reader', () => {
    it('runs a task that names a served model as a reader on that model and effort', async () => {
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 'Read it', model: 'acme/small', thinkingLevel: 'low' }])
        const { child } = runs.started[0]
        expect(child.config.model).toBe('acme/small')
        expect(child.config.thinkingLevel).toBe('low')
        expect(child.config.mcpServers).toEqual([])
        expect(Object.entries(child.config.tools).filter(([, on]) => on === true).map(([key]) => key).sort()).toEqual(['filesystem', 'shell'])
        expect(child.config.tools.memory).toBe(false)
        expect(child.soul).not.toBe('Boss soul')
        expect(child.soul).toContain('file, the function and the quoted lines')
        expect(child.soul).toContain('no opinion and no plan')
        expect(child.soul).toContain('Change nothing')
    })

    it('runs a task without a model as today', async () => {
        const { ctx } = ctxWith()
        await delegate(ctx, [{ task: 'a' }, { task: 'b', model: 'acme/small' }])
        const a = runs.started.find(r => r.prompt === 'a')!.child
        expect(a.config.model).toBe('acme/large')
        expect(a.soul).toBe('Boss soul')
        expect(a.config.tools.web).toBe(true)
    })

    it('refuses a model the connection does not serve, lists the served ones and starts nothing', async () => {
        const { ctx } = ctxWith()
        const answer = await delegate(ctx, [{ task: 'a' }, { task: 'b', model: 'acme/other' }])
        expect(runs.started).toHaveLength(0)
        expect(answer).toContain('acme/other')
        expect(answer).toContain('acme/large, acme/small')
    })
})
