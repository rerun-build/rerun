import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-compact-'))
process.env.RERUN_API_KEY = ''

type Row = { id: string; role: string; contentJson: string; createdAt: string }

const { SUMMARY } = vi.hoisted(() => ({ SUMMARY: '## Historical Task Snapshot\nCondensed history.' }))

const state = vi.hoisted(() => ({
    rows: [] as Row[],
    checkpoint: null as null | { summaryJson: string; throughCreatedAt: string },
    afterArgs: [] as Array<string | undefined>,
    saved: [] as unknown[],
    summary: `  ${SUMMARY}  ` as string | Error,
    prompts: [] as Array<Record<string, unknown>>,
    cliAuth: [] as Array<{ provider: string; beforeSummary: number }>,
    steps: [] as Array<Record<string, unknown>>,
    providerMetadata: undefined as Record<string, Record<string, never>> | undefined,
}))

vi.mock('../../agents/providers.js', async () => {
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        modelFor: () =>
            new MockLanguageModelV3({
                doGenerate: async options => {
                    state.prompts.push(options as unknown as Record<string, unknown>)
                    if (state.summary instanceof Error) throw state.summary
                    return {
                        content: [{ type: 'text', text: state.summary }],
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                        warnings: [],
                        ...(state.providerMetadata ? { providerMetadata: state.providerMetadata } : {}),
                    }
                },
            }),
    }
})
vi.mock('../../connections/cli-auth.js', () => ({
    ensureCliAuth: async (provider: string) => {
        state.cliAuth.push({ provider, beforeSummary: state.prompts.length })
        return () => {}
    },
}))
vi.mock('../../db/repos/messages.js', () => ({
    listMessagesAfter: async (_agentId: string, _sessionId: string, after?: string) => {
        state.afterArgs.push(after)
        return state.rows
    },
}))
vi.mock('../../db/repos/telemetry.js', () => ({
    insertRunStep: async (_agentId: string, row: Record<string, unknown>) => {
        state.steps.push(row)
    },
}))
vi.mock('../../db/repos/checkpoints.js', () => ({
    getLatestCheckpoint: async () => state.checkpoint,
    saveCheckpoint: async (_agentId: string, _sessionId: string, input: unknown) => {
        state.saved.push(input)
        return input
    },
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { prepareRunHistory } = await import('./compact.js')

const CHUNK = 40_000

function row(index: number, role: string, content: unknown): Row {
    return { id: `m${index}`, role, contentJson: JSON.stringify(content), createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z` }
}

function longHistory(): Row[] {
    const rows = [
        row(0, 'user', [
            { type: 'text', text: 'first question ' + 'x'.repeat(CHUNK) },
            { type: 'text', text: '<relevant_memories>\n- (fact) RECALLED MEMORY\n</relevant_memories>', providerOptions: { rerun: { context: true } } },
        ]),
        row(1, 'assistant', [
            { type: 'text', text: 'Listing files.' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: { command: 'ls' } },
        ]),
        row(2, 'tool', [{ type: 'tool-result', toolCallId: 'c1', toolName: 'shell_exec', output: { type: 'json', value: 'y'.repeat(CHUNK) } }]),
        row(3, 'assistant', [
            { type: 'reasoning', text: 'SECRET THOUGHT' },
            { type: 'text', text: 'z'.repeat(CHUNK) },
        ]),
    ]
    for (let i = 4; i < 12; i++) rows.push(row(i, i % 2 ? 'assistant' : 'user', `${i}`.padEnd(CHUNK, '.')))
    return rows
}

function context(model = 'gpt-4o', extra: Record<string, unknown> = {}) {
    const writes: Array<{ type: string; id: string; data: Record<string, unknown> }> = []
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const ctx = { agent: { id: 'compact-agent', resolved: { provider: 'openai', model, connection: null } }, sessionId: 'sess', provider: 'openai', model, logger, writer: { write: (chunk: never) => writes.push(chunk) }, ...extra } as never
    return { ctx, writes, logger }
}

afterEach(() => {
    state.rows = []
    state.checkpoint = null
    state.afterArgs = []
    state.saved = []
    state.summary = `  ${SUMMARY}  `
    state.prompts = []
    state.cliAuth = []
    state.steps = []
    state.providerMetadata = undefined
})

describe('prepareRunHistory', () => {
    it('returns the history as stored when the model window is unknown', async () => {
        state.rows = longHistory()
        const { ctx, writes } = context('no-such-model')

        const history = await prepareRunHistory(ctx, 'system')

        expect(history).toHaveLength(12)
        expect(state.afterArgs).toEqual([undefined])
        expect(state.prompts).toHaveLength(0)
        expect(writes).toHaveLength(0)
    })

    // RER-314: an earlier summary has no copy to read again, a cut tool result does.
    it('keeps the earlier summary whole and cuts the tool results to make room', async () => {
        const prior = `## Historical Task Snapshot\nPRIOR ${'s'.repeat(100_000)} END OF PRIOR`
        state.checkpoint = { summaryJson: JSON.stringify({ role: 'user', content: prior }), throughCreatedAt: 't' }
        state.rows = [
            row(0, 'user', 'go on'),
            ...Array.from({ length: 8 }, (_, i) => [
                row(1 + 2 * i, 'assistant', [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'shell_exec', input: { command: `step ${i}` } }]),
                row(2 + 2 * i, 'tool', [{ type: 'tool-result', toolCallId: `c${i}`, toolName: 'shell_exec', output: { type: 'text', value: `${i}`.padEnd(CHUNK, '.') } }]),
            ]).flat(),
        ]
        const { ctx } = context()

        await prepareRunHistory(ctx, 'system')

        expect(state.prompts).toHaveLength(1)
        const prompt = JSON.stringify(state.prompts[0].prompt)
        expect(prompt).toContain(JSON.stringify(prior).slice(1, -1))
        expect(prompt).toContain('characters cut]')
    })

    it('strips the reasoning of stored turns', async () => {
        state.rows = [row(0, 'assistant', [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'answer' }])]
        const { ctx } = context('no-such-model')

        expect(await prepareRunHistory(ctx, 'system')).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }])
    })

    // A turn cut off while the model was still thinking: replayed empty, Mistral refuses the whole
    // request ("Assistant message must have either content or tool_calls").
    it('drops a stored turn that held nothing but reasoning', async () => {
        state.rows = [row(0, 'user', [{ type: 'text', text: 'hi' }]), row(1, 'assistant', [{ type: 'reasoning', text: 'The user said hi.' }]), row(2, 'user', [{ type: 'text', text: 'again' }])]
        const { ctx } = context('no-such-model')

        expect(await prepareRunHistory(ctx, 'system')).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
            { role: 'user', content: [{ type: 'text', text: 'again' }] },
        ])
    })

    // The old tool's calls fill stored turns; a model that reads them imitates a call that no
    // longer exists. A call-first turn held nothing but the call, and goes with it.
    it('drops the calls of the old quick replies tool, and the turn that only held one', async () => {
        state.rows = [
            row(0, 'assistant', [{ type: 'tool-call', toolCallId: 'q1', toolName: 'mcp__rerun__suggest_replies', input: { replies: ['Go on'] } }]),
            row(1, 'tool', [{ type: 'tool-result', toolCallId: 'q1', toolName: 'mcp__rerun__suggest_replies', output: { type: 'text', value: 'Shown.' } }]),
            row(2, 'assistant', [{ type: 'text', text: 'answer' }, { type: 'tool-call', toolCallId: 'q2', toolName: 'suggest_replies', input: { replies: ['Go on'] } }, { type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: {} }]),
        ]
        const { ctx } = context('no-such-model')

        expect(await prepareRunHistory(ctx, 'system')).toEqual([
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'q1', toolName: 'mcp__rerun__suggest_replies', output: { type: 'text', value: 'Shown.' } }] },
            { role: 'assistant', content: [{ type: 'text', text: 'answer' }, { type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: {} }] },
        ])
    })

    it('leaves a history under 75% of the window alone', async () => {
        state.rows = [row(0, 'user', 'hello'), row(1, 'assistant', 'hi')]
        const { ctx, writes } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(history).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ])
        expect(state.prompts).toHaveLength(0)
        expect(writes).toHaveLength(0)
    })

    it('reads only past the last checkpoint and puts its summary first', async () => {
        const prior = { role: 'user', content: 'EARLIER SUMMARY' }
        state.checkpoint = { summaryJson: JSON.stringify(prior), throughCreatedAt: '2025-12-31T00:00:00.000Z' }
        state.rows = [row(0, 'user', 'next')]
        const { ctx } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(state.afterArgs).toEqual(['2025-12-31T00:00:00.000Z'])
        expect(history).toEqual([prior, { role: 'user', content: 'next' }])
    })

    it('does not compact when the recent tail already covers every stored message', async () => {
        state.rows = [row(0, 'user', 'short'), row(1, 'assistant', 'reply')]
        const { ctx, writes } = context()

        const history = await prepareRunHistory(ctx, 'x'.repeat(400_000))

        expect(history).toHaveLength(2)
        expect(state.prompts).toHaveLength(0)
        expect(writes).toHaveLength(0)
    })

    it('does not compact a lone prior summary followed by a tail that fits', async () => {
        state.checkpoint = { summaryJson: JSON.stringify({ role: 'user', content: 'S' }), throughCreatedAt: 't' }
        state.rows = [row(0, 'user', 'short')]
        const { ctx } = context()

        expect(await prepareRunHistory(ctx, 'x'.repeat(400_000))).toHaveLength(2)
        expect(state.saved).toHaveLength(0)
    })

    it('summarises everything before the tail, saves a checkpoint and reports progress', async () => {
        state.rows = longHistory()
        const { ctx, writes, logger } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(state.prompts).toHaveLength(1)
        const call = state.prompts[0]
        expect(call.maxOutputTokens).toBe(12_000)
        expect(call.temperature).toBe(0)
        const prompt = JSON.stringify(call.prompt)
        expect(prompt).toContain('dense handoff summary')
        expect(prompt).toContain('[user]')
        expect(prompt).toContain('first question')
        expect(prompt).toContain('→ called shell_exec')
        expect(prompt).toContain('← shell_exec result:')
        // Eight messages of 40,000 characters overflow the budget of gpt-4o's 96k threshold on their
        // own: the result of `ls` gives way whole before they do, then each of them keeps its head.
        expect(prompt).not.toContain('[pruned]')
        expect(prompt).not.toContain('y'.repeat(100))
        expect(prompt).toContain(`first question ${'x'.repeat(20_000)}`)
        expect(prompt).toContain('characters cut]')
        const [system, user] = call.prompt as [{ content: string }, { content: Array<{ text: string }> }]
        expect(system.content.length + user.content.map(part => part.text).join('').length).toBeLessThanOrEqual((96_000 - 12_000) * 3)
        expect(prompt).not.toContain('SECRET THOUGHT')
        expect(prompt).not.toContain('RECALLED MEMORY')
        expect(prompt).not.toContain('10....')

        expect(state.saved).toHaveLength(1)
        const saved = state.saved[0] as { summaryMessage: { role: string; content: string }; throughMessageId: string; throughCreatedAt: string }
        expect(saved.throughMessageId).toBe('m9')
        expect(saved.throughCreatedAt).toBe(state.rows[9].createdAt)
        expect(saved.summaryMessage.role).toBe('user')
        expect(saved.summaryMessage.content).toMatch(/^The following is a compacted summary[\s\S]*\n\n## Historical Task Snapshot\nCondensed history\.$/)

        expect(history).toEqual([saved.summaryMessage, { role: 'user', content: '10'.padEnd(CHUNK, '.') }, { role: 'assistant', content: '11'.padEnd(CHUNK, '.') }])

        expect(writes).toHaveLength(2)
        expect(writes[0]).toEqual({ type: 'data-compaction', id: expect.any(String), data: { status: 'running' } })
        expect(writes[1]).toEqual({ type: 'data-compaction', id: writes[0].id, data: { status: 'done', messagesCompacted: 10, tokensRecovered: expect.any(Number) } })
        expect(writes[1].data.tokensRecovered).toBeGreaterThan(0)
        expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ messagesCompacted: 10 }), 'context compacted')
    })

    // A CLI reads its token at spawn, and the run only refreshed it after the history was prepared:
    // a compaction on a token that lapsed failed with "OAuth access token has expired".
    it('refreshes the CLI login before it summarises', async () => {
        state.rows = longHistory()
        const { ctx } = context()

        await prepareRunHistory(ctx, 'system')

        expect(state.cliAuth).toEqual([{ provider: 'openai', beforeSummary: 0 }])
        expect(state.prompts).toHaveLength(1)
    })

    it('points the checkpoint at the last row summarised when a stored turn is left out', async () => {
        const [first, ...rest] = longHistory()
        state.rows = [first, { ...row(0, 'assistant', [{ type: 'reasoning', text: 'cut while thinking' }]), id: 'cut' }, ...rest]
        const { ctx, writes } = context()

        await prepareRunHistory(ctx, 'system')

        expect((state.saved[0] as { throughMessageId: string }).throughMessageId).toBe('m9')
        expect(writes[1].data.messagesCompacted).toBe(10)
    })

    it('folds the prior summary into the new one and points the checkpoint at the right row', async () => {
        state.checkpoint = { summaryJson: JSON.stringify({ role: 'user', content: 'EARLIER SUMMARY' }), throughCreatedAt: 't' }
        state.rows = longHistory()
        const { ctx, writes } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(JSON.stringify(state.prompts[0].prompt)).toContain('EARLIER SUMMARY')
        expect((state.saved[0] as { throughMessageId: string }).throughMessageId).toBe('m9')
        expect(writes[1].data.messagesCompacted).toBe(10)
        expect(history).toHaveLength(3)
        expect(JSON.stringify(history[0])).not.toContain('EARLIER SUMMARY')
    })

    it('goes on uncompacted when the summary call fails', async () => {
        state.rows = longHistory()
        state.summary = new Error('model overloaded')
        const { ctx, writes, logger } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(history).toHaveLength(12)
        expect(JSON.stringify(history)).not.toContain('SECRET THOUGHT')
        expect(state.saved).toHaveLength(0)
        expect(writes.map(w => w.data.status)).toEqual(['running', 'error'])
        expect(writes[1].id).toBe(writes[0].id)
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ agent: 'compact-agent', err: expect.stringContaining('model overloaded') }), 'compaction failed')
    })

    // A model that reads a transcript ending on a tool result may carry it on or answer it. Saved, that
    // text would be all that is left of the conversation.
    it.each([
        ['a tool call', '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="shell_exec">\n<｜｜DSML｜｜ parameter name="command" string="true">ls</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>'],
        ['a tool call in another markup', '<shell_exec command="ls">'],
        ['an answer to the user', "Yes, it's possible. Here's how it works."],
        ['nothing', '   '],
    ])('goes on uncompacted when the model wrote %s instead of a summary', async (_, text) => {
        state.rows = longHistory()
        state.summary = text
        const { ctx, writes, logger } = context('gpt-4o', { runId: 'run-1' })

        const history = await prepareRunHistory(ctx, 'system')

        expect(history).toHaveLength(12)
        expect(state.saved).toHaveLength(0)
        expect(writes.map(w => w.data.status)).toEqual(['running', 'error'])
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringContaining(`not a summary, starting ${JSON.stringify(text.trim().slice(0, 100))}`) }), 'compaction failed')
        expect(state.steps).toEqual([expect.objectContaining({ runId: 'run-1', finishReason: 'compaction' })])
    })

    it('closes the transcript and asks for the summary after it', async () => {
        state.rows = longHistory()
        const { ctx } = context()

        await prepareRunHistory(ctx, 'system')

        const messages = state.prompts[0].prompt as Array<{ role: string; content: Array<{ text: string }> }>
        const text = messages.at(-1)!.content[0].text
        expect(text.startsWith('<transcript>\n[user]')).toBe(true)
        expect(text.slice(text.lastIndexOf('</transcript>'))).toContain('## Historical Task Snapshot')
    })

    it('gives up at once on a run that was already stopped', async () => {
        state.rows = longHistory()
        const controller = new AbortController()
        controller.abort(new Error('stopped'))
        const { ctx, writes } = context('gpt-4o', { abortSignal: controller.signal })

        const history = await prepareRunHistory(ctx, 'system')

        expect(history).toHaveLength(12)
        expect(state.saved).toHaveLength(0)
        expect(writes.map(w => w.data.status)).toEqual(['running', 'error'])
    })

    it('records what the summary cost as a step of the run', async () => {
        state.rows = longHistory()
        const { ctx } = context('gpt-4o', { runId: 'run-1' })

        await prepareRunHistory(ctx, 'system')

        expect(state.steps).toEqual([expect.objectContaining({ runId: 'run-1', agentId: 'compact-agent', stepNumber: 0, finishReason: 'compaction', inputTokens: 1, outputTokens: 1, toolCallCount: 0 })])
    })

    it('adds what the summary cost to the cost of the run', async () => {
        state.rows = longHistory()
        state.providerMetadata = { openrouter: { usage: { cost: 0.0042 } as never } }
        const { ctx } = context('gpt-4o', { runId: 'run-1' })

        await prepareRunHistory(ctx, 'system')

        expect((ctx as { compactionCostMicros?: number }).compactionCostMicros).toBe(4200)
        expect(state.steps).toEqual([expect.objectContaining({ costMicros: 4200 })])
    })

    it('records nothing for a compaction outside a run', async () => {
        state.rows = longHistory()
        const { ctx } = context()

        await prepareRunHistory(ctx, 'system')

        expect(state.steps).toHaveLength(0)
    })

    it('compacts without a writer attached', async () => {
        state.rows = longHistory()
        const { ctx } = context('gpt-4o', { writer: undefined })

        expect(await prepareRunHistory(ctx, 'system')).toHaveLength(3)
        expect(state.saved).toHaveLength(1)
    })
})
