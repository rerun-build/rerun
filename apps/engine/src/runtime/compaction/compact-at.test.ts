import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-compact-at-'))
process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({ prompts: 0, sent: [] as string[], fail: false }))

vi.mock('../../agents/providers.js', async importOriginal => {
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...(await importOriginal<object>()),
        modelFor: () =>
            new MockLanguageModelV3({
                doGenerate: async options => {
                    state.prompts += 1
                    state.sent.push(JSON.stringify(options.prompt))
                    if (state.fail) {
                        state.fail = false
                        throw new Error('summary down')
                    }
                    return {
                        content: [{ type: 'text', text: 'Condensed.' }],
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                        warnings: [],
                    }
                },
            }),
    }
})
vi.mock('../../connections/cli-auth.js', () => ({ ensureCliAuth: async () => () => {} }))

const { afterEach, describe, expect, it } = await import('vitest')
const { CUSTOM_DEFAULT_CONTEXT_WINDOW } = await import('@rerun/contracts')
const { effectiveCompactAt, stepContextGuard } = await import('./compact.js')
type Message = import('ai').ModelMessage

const writes: Array<{ type: string; data: Record<string, unknown> }> = []
const logs: Array<[unknown, string]> = []

afterEach(() => {
    state.prompts = 0
    state.sent = []
    state.fail = false
    writes.length = 0
    logs.length = 0
    delete process.env.RERUN_COMPACT_AT_SMALL
})

function custom(contextWindow?: number) {
    return { id: 'c1', config: { contextWindow } } as never
}

describe('effectiveCompactAt', () => {
    it('clamps an engine provider to 0.75 of its window', () => {
        expect(effectiveCompactAt('small', 'custom', 'm', custom(262144))).toBe(196608)
        expect(effectiveCompactAt('small', 'custom', 'm', custom(524288))).toBe(240000)
        expect(effectiveCompactAt('large', 'custom', 'm', custom(524288))).toBe(393216)
        expect(effectiveCompactAt('large', 'custom', 'm', custom(1048576))).toBe(786432)
    })

    it('gives small windows a small, positive point', () => {
        expect(effectiveCompactAt('small', 'custom', 'm', custom(32768))).toBe(24576)
        expect(effectiveCompactAt('small', 'custom', 'm', custom(65536))).toBe(49152)
    })

    it('keeps the class point on a model whose window is unknown, and clamps a custom endpoint to its default window', () => {
        expect(effectiveCompactAt('large', 'openai', 'no-such-model')).toBe(940000)
        expect(effectiveCompactAt('large', 'custom', 'm', custom())).toBe(Math.min(940000, Math.floor(CUSTOM_DEFAULT_CONTEXT_WINDOW * 0.75)))
    })

    it('stays off when the size is off and reads the class point from the environment', () => {
        expect(effectiveCompactAt('off', 'custom', 'm', custom(262144))).toBeNull()
        process.env.RERUN_COMPACT_AT_SMALL = '150000'
        expect(effectiveCompactAt(undefined, 'openai', 'no-such-model')).toBe(150000)
    })
})

const ctx = { agent: { id: 'a', resolved: { provider: 'openai', model: 'm', connection: null } }, sessionId: 's', logger: { error: (o: unknown, m: string) => logs.push([o, m]), info: (o: unknown, m: string) => logs.push([o, m]) }, writer: { write: (chunk: never) => writes.push(chunk) } } as never

function text(role: 'user' | 'assistant', length: number, ch = 'x'): Message {
    return { role, content: [{ type: 'text', text: ch.repeat(length) }] } as Message
}

const TAIL = [text('user', 20_000), text('assistant', 20_000), text('user', 20_000), text('assistant', 20_000)]
const AT = 60_000

describe('stepContextGuard', () => {
    it('leaves a step under the point alone', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, AT, 2, e => events.push(e))
        expect(await guard([text('user', 100), ...TAIL.slice(0, 2)])).toBeUndefined()
        expect(events).toEqual([])
    })

    it('prunes old tool outputs first, logs that once and does not count it as a compaction', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, AT, 0, e => events.push(e))
        const messages: Message[] = [
            text('user', 100),
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: {} }] } as Message,
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'shell_exec', output: { type: 'text', value: 'y'.repeat(200_000) } }] } as Message,
            text('assistant', 100),
            ...TAIL,
        ]
        const first = await guard(messages)
        expect(JSON.stringify(first)).toContain('[pruned] shell_exec')
        await guard(messages)
        expect(events).toEqual([])
        expect(logs.filter(([, message]) => message === 'in-run tool outputs pruned')).toHaveLength(1)
        expect(state.prompts).toBe(0)
    })

    it('summarises the middle when pruning is not enough, once, and keeps using that summary on later steps', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, AT, 5, e => events.push(e))
        const messages: Message[] = [text('user', 200_000), text('assistant', 100), ...TAIL.slice(0, 3), text('user', 20_000, 'T')]
        const first = (await guard(messages))!
        expect(JSON.stringify(first[0])).toContain('Condensed.')
        expect(first.at(-1)).toEqual(messages.at(-1))

        const next = text('user', 50)
        const second = (await guard([...messages, next]))!
        expect(second[0]).toEqual(first[0])
        expect(second.at(-1)).toEqual(next)
        expect(state.prompts).toBe(1)
        expect(events).toEqual([{ trigger: 'summary', summaryChars: 'Condensed.'.length }])
    })

    it('keeps the request of the turn verbatim after the summary and says in the preamble that the task is unfinished', async () => {
        const guard = stepContextGuard(ctx, undefined, 'system', 0, AT, 0, () => {})
        const request = text('user', 20_000, 'T')
        const messages: Message[] = [request, text('assistant', 200_000), ...TAIL]
        const out = (await guard(messages))!
        expect(out[1]).toEqual(request)
        expect(JSON.stringify(out[0])).toContain('still in progress')
        expect(JSON.stringify(out[0])).not.toContain('already addressed')
        expect(state.sent[0]).not.toContain('TTTT')

        const again = (await guard([...messages, text('user', 50)]))!
        expect(again[1]).toEqual(request)
        expect(state.prompts).toBe(1)
    })

    it('only prunes when the point cannot hold the prompt, the tail and a summary', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, 24_576, 0, e => events.push(e))
        const out = await guard([text('user', 100_000), text('assistant', 100), ...TAIL])
        expect(out).toBeDefined()
        expect(state.prompts).toBe(0)
        expect(events).toEqual([])
    })

    it('stops trying after a failed summary, stays prune-only and tells the stream once', async () => {
        state.fail = true
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, AT, 0, e => events.push(e))
        const messages: Message[] = [text('user', 200_000), text('assistant', 100), ...TAIL]
        expect(await guard(messages)).toBeDefined()
        expect(await guard([...messages, text('user', 50)])).toBeDefined()
        expect(await guard([...messages, text('user', 50), text('user', 60)])).toBeDefined()
        expect(state.prompts).toBe(1)
        expect(events).toEqual([])
        expect(writes.filter(chunk => chunk.type === 'data-compaction' && chunk.data.status === 'error')).toHaveLength(1)
    })
})
