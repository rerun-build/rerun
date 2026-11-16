import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-compact-'))
process.env.RERUN_API_KEY = ''

type Row = { id: string; role: string; contentJson: string; createdAt: string }

const state = vi.hoisted(() => ({
    rows: [] as Row[],
    checkpoint: null as null | { summaryJson: string; throughCreatedAt: string },
    afterArgs: [] as Array<string | undefined>,
    saved: [] as unknown[],
    summary: '  Condensed history.  ' as string | Error,
    prompts: [] as Array<Record<string, unknown>>,
    cliAuth: [] as Array<{ provider: string; beforeSummary: number }>,
    handoff: 'HANDOFF TEXT' as string | Error,
    handoffCalls: [] as string[][],
}))

vi.mock('../handoff.js', () => ({
    buildHandoff: async (agentId: string, sessionId: string) => {
        state.handoffCalls.push([agentId, sessionId])
        if (state.handoff instanceof Error) throw state.handoff
        return state.handoff
    },
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
    state.summary = '  Condensed history.  '
    state.prompts = []
    state.cliAuth = []
    state.handoff = 'HANDOFF TEXT'
    state.handoffCalls = []
    delete process.env.RERUN_HANDOFF_AT_TOKENS
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

    it('strips the reasoning of stored turns', async () => {
        state.rows = [row(0, 'assistant', [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'answer' }])]
        const { ctx } = context('no-such-model')

        expect(await prepareRunHistory(ctx, 'system')).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }])
    })

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
        expect(prompt).toContain('[pruned] shell_exec output')
        expect(prompt).not.toContain('SECRET THOUGHT')
        expect(prompt).not.toContain('RECALLED MEMORY')
        expect(prompt).not.toContain('10....')

        expect(state.saved).toHaveLength(1)
        const saved = state.saved[0] as { summaryMessage: { role: string; content: string }; throughMessageId: string; throughCreatedAt: string }
        expect(saved.throughMessageId).toBe('m9')
        expect(saved.throughCreatedAt).toBe(state.rows[9].createdAt)
        expect(saved.summaryMessage.role).toBe('user')
        expect(saved.summaryMessage.content).toMatch(/^The following is a compacted summary[\s\S]*\n\nCondensed history\.$/)

        expect(history).toEqual([saved.summaryMessage, { role: 'user', content: '10'.padEnd(CHUNK, '.') }, { role: 'assistant', content: '11'.padEnd(CHUNK, '.') }])

        expect(writes).toHaveLength(2)
        expect(writes[0]).toEqual({ type: 'data-compaction', id: expect.any(String), data: { status: 'running' } })
        expect(writes[1]).toEqual({ type: 'data-compaction', id: writes[0].id, data: { status: 'done', messagesCompacted: 10, tokensRecovered: expect.any(Number) } })
        expect(writes[1].data.tokensRecovered).toBeGreaterThan(0)
        expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ messagesCompacted: 10 }), 'context compacted')
    })

    it('refreshes the CLI login before it summarises', async () => {
        state.rows = longHistory()
        const { ctx } = context()

        await prepareRunHistory(ctx, 'system')

        expect(state.cliAuth).toEqual([{ provider: 'openai', beforeSummary: 0 }])
        expect(state.prompts).toHaveLength(1)
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

    it('compacts without a writer attached', async () => {
        state.rows = longHistory()
        const { ctx } = context('gpt-4o', { writer: undefined })

        expect(await prepareRunHistory(ctx, 'system')).toHaveLength(3)
        expect(state.saved).toHaveLength(1)
    })

    it('continues from the handoff at the set size and calls no summary model', async () => {
        process.env.RERUN_HANDOFF_AT_TOKENS = '1000'
        state.rows = longHistory()
        const { ctx, writes } = context()

        const history = await prepareRunHistory(ctx, 'system')

        expect(history[0]).toEqual({ role: 'user', content: 'HANDOFF TEXT' })
        expect(state.handoffCalls).toEqual([['compact-agent', 'sess']])
        expect(state.prompts).toHaveLength(0)
        expect(state.saved).toHaveLength(1)
        expect((state.saved[0] as { summaryMessage: unknown }).summaryMessage).toEqual({ role: 'user', content: 'HANDOFF TEXT' })
        expect(writes.at(-1)?.data.status).toBe('done')
    })

    it('keeps the tail as today', async () => {
        state.rows = longHistory()
        const baseline = await prepareRunHistory(context().ctx, 'system')
        state.saved = []
        process.env.RERUN_HANDOFF_AT_TOKENS = '1000'

        const history = await prepareRunHistory(context().ctx, 'system')

        expect(history.slice(1)).toEqual(baseline.slice(1))
        expect(history).toHaveLength(baseline.length)
    })

    it('is off at 0', async () => {
        process.env.RERUN_HANDOFF_AT_TOKENS = '0'
        state.rows = longHistory()

        const history = await prepareRunHistory(context().ctx, 'system')

        expect(state.handoffCalls).toHaveLength(0)
        expect(state.prompts).toHaveLength(1)
        expect(JSON.stringify(history[0])).toContain('Condensed history.')
    })

    it('is not used under the set size', async () => {
        process.env.RERUN_HANDOFF_AT_TOKENS = '10000000'
        state.rows = [row(0, 'user', 'hello'), row(1, 'assistant', 'hi')]

        expect(await prepareRunHistory(context().ctx, 'system')).toHaveLength(2)
        expect(state.handoffCalls).toHaveLength(0)
    })

    it('falls back to the summary when the handoff fails', async () => {
        process.env.RERUN_HANDOFF_AT_TOKENS = '1000'
        state.handoff = new Error('boom')
        state.rows = longHistory()

        const history = await prepareRunHistory(context().ctx, 'system')

        expect(state.prompts).toHaveLength(1)
        expect(JSON.stringify(history[0])).toContain('Condensed history.')
        expect(state.saved).toHaveLength(1)
    })
})
