import type { ModelMessage } from 'ai'
import { contextTextPart } from '@rerun/contracts'
import { vi } from 'vitest'

process.env.RERUN_API_KEY = ''

const { summary } = vi.hoisted(() => ({ summary: (text: string) => `## Historical Task Snapshot\n${text}` }))

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
                    const next = state.summaries.shift() ?? summary('SUMMARY')
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
const { thoughtsOf } = await import('../__fixtures__/thoughts.js')
const { withoutReasoning } = await import('../replayed-reasoning.js')
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
        expect(state.prompts[0]).not.toContain('[pruned]')
        expect(sent?.[0]).toEqual({ role: 'user', content: `${IN_RUN_SUMMARY_PREAMBLE}\n\n${summary('SUMMARY')}` })
        expect(sent?.[1]).toEqual(REQUEST)
        expect(sent?.slice(2)).toEqual(messages.slice(messages.length - (sent?.length ?? 0) + 2))
        expect(sent?.[2].role).toBe('assistant')
        expect(sent?.at(-1)).toEqual(messages.at(-1))

        // The request is covered by the summary and sent again after it: it is not counted.
        const compacted = messages.length - ((sent?.length ?? 0) - 2) - 1
        expect(writes.map(w => w.data.status)).toEqual(['running', 'done'])
        expect(writes[1]).toEqual({ type: 'data-compaction', id: writes[0].id, data: { status: 'done', messagesCompacted: compacted, tokensRecovered: expect.any(Number) } })
        expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ run: 'run-1', stepNumber: 12, messagesCompacted: compacted }), 'context compacted mid-run')
        // Ten results of ~10k tokens left the context.
        expect(writes[1].data.tokensRecovered).toBeGreaterThan(90_000)
    })

    // RER-314: a summary written from one line per result forgot the ticket the run was working on,
    // and the run read it again after every compaction.
    it('lets the summary read the ticket a tool returned and the code the run wrote, whole', async () => {
        const ticket = `MINIAPP-7 ${'rotate the csrf_token on every render. '.repeat(800)}KEEP THE EXISTING ERROR MESSAGE`
        const code = `cat > login.php <<'EOF'\n${'$token = bin2hex(random_bytes(32));\n'.repeat(200)}// END OF LOGIN.PHP\nEOF`
        const messages: ModelMessage[] = [
            ...OPENING,
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'ticket', toolName: 'tool_result_read', input: { path: '.rerun/tool-results/jira.txt' } }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'ticket', toolName: 'tool_result_read', output: { type: 'text', value: ticket } }] },
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'write', toolName: 'shell_exec', input: { command: code } }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'write', toolName: 'shell_exec', output: { type: 'text', value: 'ok' } }] },
            ...Array.from({ length: 4 }, (_, i) => toolStep(i)).flat(),
        ]

        // The provider counted the last step past the threshold: what is left to summarise fits the budget.
        await compactorFor(context().ctx)({ messages, steps: [{ usage: { inputTokens: 100_000, outputTokens: 0 } }], stepNumber: 6 })

        expect(state.prompts).toHaveLength(1)
        expect(state.prompts[0]).toContain(ticket)
        expect(state.prompts[0]).toContain(JSON.stringify(JSON.stringify({ command: code })).slice(1, -1))
        expect(state.prompts[0]).not.toContain('[pruned]')
    })

    it('keeps what the summary reads under the threshold, every result cut to its head and tail', async () => {
        const saved = `${'z'.repeat(60_000)}\n[Cut at 40,000 characters: the whole result is saved at .rerun/tool-results/big.txt]`
        const messages: ModelMessage[] = [
            ...runOf(12),
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'big', toolName: 'shell_exec', input: { command: 'cat big' } }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'big', toolName: 'shell_exec', output: { type: 'text', value: saved } }] },
            ...Array.from({ length: 2 }, (_, i) => toolStep(20 + i)).flat(),
        ]

        await compactorFor(context().ctx)({ messages, steps: noSteps, stepNumber: 15 })

        const [system, user] = JSON.parse(state.prompts[0]) as [{ content: string }, { content: Array<{ text: string }> }]
        const read = system.content.length + user.content.map(part => part.text).join('').length
        // gpt-4o is compacted at 96k tokens, and keeps 12k of them for the summary it writes.
        expect(read).toBeLessThanOrEqual((96_000 - 12_000) * 3)
        expect(read).toBeGreaterThan((96_000 - 12_000) * 3 - 2_000)
        for (let i = 0; i < 12; i++) expect(user.content[0].text).toContain(`← shell_exec result: ${i}...`)
        expect(user.content[0].text).toContain('characters cut; the whole result is saved at .rerun/tool-results/big.txt, read it with tool_result_read]')
    })

    it('keeps a message whole and cuts the tool results first when the budget is short', async () => {
        const pasted = `MINIAPP-9 ${'a ticket pasted in the chat. '.repeat(5_000)}END OF TICKET`
        const messages: ModelMessage[] = [{ role: 'user', content: pasted }, OPENING[1], REQUEST, ...Array.from({ length: 10 }, (_, i) => toolStep(i)).flat()]

        await compactorFor(context().ctx)({ messages, steps: noSteps, stepNumber: 10 })

        expect(state.prompts).toHaveLength(1)
        expect(state.prompts[0]).toContain(pasted)
        expect(state.prompts[0]).toContain('characters cut]')
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

        expect(state.steps).toEqual([expect.objectContaining({ runId: 'run-1', stepNumber: 12, finishReason: 'compaction', inputTokens: 900, outputTokens: 40, toolCallCount: 0, textLength: summary('SUMMARY').length })])
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
        state.summaries = [summary('FIRST SUMMARY'), summary('SECOND SUMMARY')]
        const { ctx, writes } = context()
        const compact = compactorFor(ctx)
        await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })

        const sent = await compact({ messages: runOf(24), steps: noSteps, stepNumber: 24 })

        expect(state.prompts).toHaveLength(2)
        expect(state.prompts[1]).toContain('FIRST SUMMARY')
        expect(state.prompts[1]).toContain('THE REQUEST')
        expect(sent?.[0]).toEqual({ role: 'user', content: `${IN_RUN_SUMMARY_PREAMBLE}\n\n${summary('SECOND SUMMARY')}` })
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

    it('refuses a summary that is none, and waits for the run to grow before trying again', async () => {
        state.summaries = ['<shell_exec command="ls">']
        const { ctx, writes, logger } = context()
        const compact = compactorFor(ctx)

        expect(await compact({ messages: runOf(12), steps: noSteps, stepNumber: 12 })).toBeUndefined()
        expect(await compact({ messages: runOf(12), steps: noSteps, stepNumber: 13 })).toBeUndefined()
        expect(state.prompts).toHaveLength(1)
        expect(writes.map(w => w.data.status)).toEqual(['running', 'error'])
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringContaining('not a summary') }), 'mid-run compaction failed')
        expect(state.steps).toHaveLength(1)

        const sent = await compact({ messages: runOf(15), steps: noSteps, stepNumber: 15 })
        expect(sent?.[0]).toEqual({ role: 'user', content: `${IN_RUN_SUMMARY_PREAMBLE}\n\n${summary('SUMMARY')}` })
    })
})

// Anthropic signs a thought with everything that came before it and the thought it followed, and
// refuses a request where either changed ("The block is bound to a different conversation").
function anthropicApi() {
    const signed = new Map<string, { prefix: string; previous: string | undefined }>()
    const signatureOf = (part: unknown) => (part as { providerOptions?: { anthropic?: { signature?: string } } }).providerOptions?.anthropic?.signature
    const prefixOf = (messages: ModelMessage[]) => JSON.stringify(messages.map(withoutReasoning))
    const signaturesOf = (messages: ModelMessage[]) =>
        messages.flatMap((message, index) => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'reasoning').map(part => ({ index, signature: signatureOf(part)! })))

    return {
        check(sent: ModelMessage[]) {
            signaturesOf(sent).forEach(({ index, signature }, i, all) => {
                const bound = signed.get(signature)!
                if (bound.prefix !== prefixOf(sent.slice(0, index))) throw new Error(`Invalid signature in thinking block at messages.${index}: content before it was rewritten`)
                if (i > 0 && bound.previous !== all[i - 1].signature) throw new Error(`Invalid signature in thinking block at messages.${index}: the thought before it is missing`)
            })
        },
        answer(sent: ModelMessage[], index: number): ModelMessage[] {
            const signature = `sig-${index}`
            signed.set(signature, { prefix: prefixOf(sent), previous: signaturesOf(sent).at(-1)?.signature })
            return reasonedStep(index, signature)
        },
    }
}

function reasonedStep(index: number, signature: string): ModelMessage[] {
    const [call, result] = toolStep(index)
    return [{ role: 'assistant', content: [{ type: 'reasoning', text: `thought ${index}`, providerOptions: { anthropic: { signature } } }, ...(call.content as never[])] }, result]
}

async function runOnAnthropic(stepCount: number, provider = 'anthropic', model = 'claude-sonnet-5-5') {
    const api = anthropicApi()
    const { ctx, writes } = context(provider, model)
    const compact = compactorFor(ctx)
    const views: ModelMessage[][] = []
    let messages = OPENING
    for (let stepNumber = 0; stepNumber < stepCount; stepNumber++) {
        const sent = (await compact({ messages, steps: noSteps, stepNumber })) ?? messages
        api.check(sent)
        views.push(sent)
        messages = [...messages, ...api.answer(sent, stepNumber)]
    }
    const compactedAt = views.findIndex(view => JSON.stringify(view[0]).includes(IN_RUN_SUMMARY_PREAMBLE))
    return { views, writes, compactedAt }
}

describe('the signed thinking of a run on the Anthropic API', () => {
    it('is not replayed behind the summary that rewrote what it was signed against', async () => {
        const { views, compactedAt } = await runOnAnthropic(20)

        expect(thoughtsOf(views[compactedAt - 1])).toHaveLength(compactedAt - 1)
        expect(thoughtsOf(views[compactedAt])).toEqual([])
        expect(views[compactedAt].at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${compactedAt - 1}` }] })
        expect(views[compactedAt].at(-1)).toMatchObject({ role: 'tool', content: [{ toolCallId: `c${compactedAt - 1}` }] })
    })

    it('is replayed once the summary is there, behind a kept tail that never moves again', async () => {
        const { views, compactedAt } = await runOnAnthropic(20)
        const later = views[compactedAt + 2]

        expect(later.slice(0, views[compactedAt].length)).toEqual(views[compactedAt])
        expect(thoughtsOf(later)).toEqual([`thought ${compactedAt}`, `thought ${compactedAt + 1}`])
    })

    it('is dropped again by every later summary', async () => {
        state.summaries = [summary('FIRST SUMMARY'), summary('SECOND SUMMARY')]
        const { views, compactedAt } = await runOnAnthropic(45)
        const compactedAgainAt = views.findIndex(view => JSON.stringify(view[0]).includes('SECOND SUMMARY'))

        expect(compactedAgainAt).toBeGreaterThan(compactedAt)
        expect(thoughtsOf(views[compactedAgainAt - 1])).not.toEqual([])
        expect(thoughtsOf(views[compactedAgainAt])).toEqual([])
        expect(thoughtsOf(views[compactedAgainAt + 1])).toEqual([`thought ${compactedAgainAt}`])
    })

    it('stays as it was when a later summary fails', async () => {
        state.summaries = [summary('FIRST SUMMARY'), new Error('model overloaded')]
        const { writes } = await runOnAnthropic(34)

        expect(writes.map(write => write.data.status).slice(0, 4)).toEqual(['running', 'done', 'running', 'error'])
    })

    it('is dropped on an OpenCode model served in the Anthropic format', async () => {
        const { views, compactedAt } = await runOnAnthropic(20, 'opencode', 'go/claude-haiku-5-5')

        expect(thoughtsOf(views[compactedAt])).toEqual([])
    })
})

// OpenAI chains a call to the reasoning item it came from, Google signs the call itself: neither
// binds a thought to the messages before it.
it.each([
    ['openai', 'gpt-4o'],
    ['google', 'gemini-3.8-flash'],
])('keeps the thinking of the kept tail on %s', async (provider, model) => {
    const compact = compactorFor(context(provider, model).ctx)
    const messages = [...OPENING, ...Array.from({ length: 16 }, (_, i) => reasonedStep(i, `sig-${i}`)).flat()]

    const sent = await compact({ messages, steps: noSteps, stepNumber: 16 })

    expect(state.prompts).toHaveLength(1)
    expect(thoughtsOf(sent)).toContain('thought 15')
})

describe('turnIndexOf', () => {
    it('finds the request past the note a backup adds to carry a turn on', () => {
        const note: ModelMessage = { role: 'user', content: [contextTextPart('The previous model stopped partway through this turn.')] }
        expect(turnIndexOf([...OPENING, ...toolStep(0), note])).toBe(2)
        expect(turnIndexOf([{ role: 'assistant', content: 'hi' }])).toBeUndefined()
    })
})
