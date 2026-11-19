import type { ModelMessage } from 'ai'
import { contextTextPart } from '@rerun/contracts'
import { vi } from 'vitest'

process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({
    summaries: [] as Array<string | Error>,
    prompts: [] as string[],
    steps: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../agents/providers.js', async () => {
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        modelFor: () =>
            new MockLanguageModelV3({
                doGenerate: async options => {
                    state.prompts.push(JSON.stringify(options.prompt))
                    const next = state.summaries.shift() ?? 'SUMMARY'
                    if (next instanceof Error) throw next
                    return {
                        content: [{ type: 'text', text: next }],
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } },
                        warnings: [],
                    }
                },
            }),
    }
})
vi.mock('../../connections/cli-auth.js', () => ({ ensureCliAuth: async () => () => {} }))
vi.mock('../../db/repos/telemetry.js', () => ({
    insertRunStep: async (_agentId: string, row: Record<string, unknown>) => {
        state.steps.push(row)
    },
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { createInRunCompactor, IN_RUN_SUMMARY_PREAMBLE, turnIndexOf } = await import('./in-run.js')

// gpt-4o's window is 128k, so the run is compacted past 96k estimated tokens.
const OUTPUT = 40_000
const REQUEST: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'THE REQUEST' }] }
const OPENING: ModelMessage[] = [{ role: 'user', content: 'old question' }, { role: 'assistant', content: 'old answer' }, REQUEST]

function toolStep(index: number, size = OUTPUT): ModelMessage[] {
    return [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${index}`, toolName: 'shell_exec', input: { command: `step ${index}` } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${index}`, toolName: 'shell_exec', output: { type: 'json', value: `${index}`.padEnd(size, '.') } }] },
    ]
}

function runOf(count: number, size = OUTPUT): ModelMessage[] {
    return [...OPENING, ...Array.from({ length: count }, (_, i) => toolStep(i, size)).flat()]
}

function context(provider = 'openai', model = 'gpt-4o') {
    const writes: Array<{ type: string; id: string; data: Record<string, unknown> }> = []
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const ctx = { agent: { id: 'in-run-agent', resolved: { provider, model, connection: null } }, sessionId: 'sess', runId: 'run-1', provider, model, logger, writer: { write: (chunk: never) => writes.push(chunk) } } as never
    return { ctx, writes, logger }
}

function compactorFor(ctx: never, system = 'system') {
    const compact = createInRunCompactor(ctx, { system, toolChars: 0, initialMessages: OPENING })
    if (!compact) throw new Error('no compactor')
    return compact
}

const noSteps = [{ usage: { inputTokens: 10, outputTokens: 5 } }]

afterEach(() => {
    state.summaries = []
    state.prompts = []
    state.steps = []
})

describe('createInRunCompactor', () => {
    // The CLI runs the whole turn as one step: the loop never gets a word in between.
    it('stays out of the CLI providers and of a model whose window is unknown', () => {
        expect(createInRunCompactor(context('claude', 'claude-opus-4-5').ctx, { system: '', toolChars: 0, initialMessages: OPENING })).toBeUndefined()
        expect(createInRunCompactor(context('codex', 'gpt-5').ctx, { system: '', toolChars: 0, initialMessages: OPENING })).toBeUndefined()
        expect(createInRunCompactor(context('openai', 'no-such-model').ctx, { system: '', toolChars: 0, initialMessages: OPENING })).toBeUndefined()
    })

    it('leaves the opening step and a run under the threshold alone', async () => {
        const compact = compactorFor(context().ctx)

        expect(await compact({ messages: runOf(12), steps: [], stepNumber: 0 })).toBeUndefined()
        expect(await compact({ messages: runOf(3), steps: noSteps, stepNumber: 3 })).toBeUndefined()
        expect(state.prompts).toHaveLength(0)
    })

    it('summarises all but the tail, keeps the request whole and reports it', async () => {
        const { ctx, writes, logger } = context()
        const compact = compactorFor(ctx)
        const messages = runOf(12)

        const sent = await compact({ messages, steps: noSteps, stepNumber: 12 })

        expect(state.prompts).toHaveLength(1)
        expect(state.prompts[0]).toContain('THE REQUEST')
        expect(state.prompts[0]).toContain('[pruned] shell_exec output')
        expect(sent?.[0]).toEqual({ role: 'user', content: `${IN_RUN_SUMMARY_PREAMBLE}\n\nSUMMARY` })
        expect(sent?.[1]).toEqual(REQUEST)
        expect(sent?.slice(2)).toEqual(messages.slice(messages.length - (sent?.length ?? 0) + 2))
        expect(sent?.[2].role).toBe('assistant')
        expect(sent?.at(-1)).toEqual(messages.at(-1))

        // The request is covered by the summary and sent again after it: it is not counted.
        const compacted = messages.length - ((sent?.length ?? 0) - 2) - 1
        expect(writes.map(w => w.data.status)).toEqual(['running', 'done'])
        expect(writes[1]).toEqual({ type: 'data-compaction', id: writes[0].id, data: { status: 'done', messagesCompacted: compacted, tokensRecovered: expect.any(Number) } })
        expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ run: 'run-1', stepNumber: 12, messagesCompacted: compacted }), 'context compacted mid-run')
        // Ten results of ~10k tokens left the context, even though the summary read them pruned.
        expect(writes[1].data.tokensRecovered).toBeGreaterThan(90_000)
    })

    it('does not count the request it sends again among what it recovered', async () => {
        const request: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'R'.repeat(200_000) }] }
        const { ctx, writes } = context()
        const compact = createInRunCompactor(ctx, { system: 'system', toolChars: 0, initialMessages: [request] })
        const messages = [request, ...Array.from({ length: 6 }, (_, i) => toolStep(i)).flat()]

        const sent = await compact?.({ messages, steps: noSteps, stepNumber: 6 })

        expect(sent?.[1]).toEqual(request)
        // Five steps of ~10k tokens left the context; the 50k tokens of the request did not.
        expect(writes[1].data.messagesCompacted).toBe(10)
        expect(writes[1].data.tokensRecovered).toBeGreaterThan(45_000)
        expect(writes[1].data.tokensRecovered).toBeLessThan(55_000)
    })

    it('pays no summary when the request is all it would cover', async () => {
        const { ctx, writes } = context()
        const compact = createInRunCompactor(ctx, { system: 'system', toolChars: 0, initialMessages: [REQUEST] })

        expect(await compact?.({ messages: [REQUEST, ...toolStep(0, 500_000)], steps: noSteps, stepNumber: 1 })).toBeUndefined()
        expect(state.prompts).toHaveLength(0)
        expect(writes).toHaveLength(0)
    })

    it('records what the summary cost among the run steps', async () => {
        const compact = compactorFor(context().ctx)

        await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })

        expect(state.steps).toEqual([expect.objectContaining({ runId: 'run-1', stepNumber: 12, finishReason: 'compaction', inputTokens: 900, outputTokens: 40, toolCallCount: 0, textLength: 'SUMMARY'.length })])
    })

    // The SDK rebuilds the full list for every step: without the summary put back, the next step
    // would read the whole run again.
    it('puts the summary back on every later step without summarising again', async () => {
        const compact = compactorFor(context().ctx)
        const first = await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })
        const messages = runOf(13)

        const sent = await compact({ messages, steps: noSteps, stepNumber: 13 })

        expect(state.prompts).toHaveLength(1)
        expect(sent?.slice(0, 2)).toEqual(first?.slice(0, 2))
        expect(sent?.slice(-2)).toEqual(messages.slice(-2))
        expect(sent).toHaveLength((first?.length ?? 0) + 2)
    })

    it('folds the earlier summary into the next one once the run fills up again', async () => {
        state.summaries = ['FIRST SUMMARY', 'SECOND SUMMARY']
        const { ctx, writes } = context()
        const compact = compactorFor(ctx)
        await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })

        const sent = await compact({ messages: runOf(24), steps: noSteps, stepNumber: 24 })

        expect(state.prompts).toHaveLength(2)
        expect(state.prompts[1]).toContain('FIRST SUMMARY')
        expect(state.prompts[1]).toContain('THE REQUEST')
        expect(sent?.[0]).toEqual({ role: 'user', content: `${IN_RUN_SUMMARY_PREAMBLE}\n\nSECOND SUMMARY` })
        expect(sent?.[1]).toEqual(REQUEST)
        expect(sent?.[2].role).toBe('assistant')
        expect(writes.filter(w => w.data.status === 'done')).toHaveLength(2)
    })

    // The estimate reads four characters to the token; the provider's count of the last step is
    // the truth when it says more.
    it('compacts on the tokens the last step really read', async () => {
        const compact = compactorFor(context().ctx)
        const messages = runOf(4)

        expect(await compact({ messages, steps: noSteps, stepNumber: 4 })).toBeUndefined()
        const sent = await compact({ messages, steps: [{ usage: { inputTokens: 100_000, outputTokens: 500 } }], stepNumber: 4 })

        expect(state.prompts).toHaveLength(1)
        expect(sent?.[1]).toEqual(REQUEST)
    })

    it('keeps the latest step whole however large its result', async () => {
        const compact = compactorFor(context().ctx)
        const messages = [...runOf(8), ...toolStep(8, 120_000)]

        const sent = await compact({ messages, steps: noSteps, stepNumber: 9 })

        expect(state.prompts).toHaveLength(1)

        expect(sent?.slice(-2)).toEqual(messages.slice(-2))
    })

    // The prompt and the tools of a coworker on a small model fill most of its window: the compacted
    // run is still past the threshold, and a summary on every step would win back nothing.
    it('waits for the run to grow by another tail before summarising again', async () => {
        const { ctx, writes } = context()
        const compact = compactorFor(ctx, 'p'.repeat(340_000))
        await compact({ messages: runOf(6), steps: noSteps, stepNumber: 6 })

        expect(await compact({ messages: runOf(7), steps: noSteps, stepNumber: 7 })).toHaveLength(6)
        expect(state.prompts).toHaveLength(1)

        await compact({ messages: runOf(9), steps: noSteps, stepNumber: 9 })
        expect(state.prompts).toHaveLength(2)
        expect(writes.filter(w => w.data.status === 'done')).toHaveLength(2)
    })

    it('goes on uncompacted after a failed summary and waits for the run to grow before trying again', async () => {
        state.summaries = [new Error('model overloaded')]
        const { ctx, writes, logger } = context()
        const compact = compactorFor(ctx)

        expect(await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })).toBeUndefined()
        expect(await compact({ messages: runOf(12), steps: noSteps, stepNumber: 13 })).toBeUndefined()
        expect(state.prompts).toHaveLength(1)
        expect(writes.map(w => w.data.status)).toEqual(['running', 'error'])
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringContaining('model overloaded') }), 'mid-run compaction failed')

        const sent = await compact({ messages: runOf(15), steps: noSteps, stepNumber: 15 })
        expect(state.prompts).toHaveLength(2)
        expect(sent?.[1]).toEqual(REQUEST)
    })
})

describe('turnIndexOf', () => {
    it('finds the request past the note a backup adds to carry a turn on', () => {
        const note: ModelMessage = { role: 'user', content: [contextTextPart('The previous model stopped partway through this turn.')] }
        expect(turnIndexOf([...OPENING, ...toolStep(0), note])).toBe(2)
        expect(turnIndexOf([{ role: 'assistant', content: 'hi' }])).toBeUndefined()
    })
})
