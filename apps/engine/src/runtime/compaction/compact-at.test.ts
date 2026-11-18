import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-compact-at-'))
process.env.RERUN_API_KEY = ''

const state = vi.hoisted(() => ({ prompts: 0 }))

vi.mock('../../agents/providers.js', async importOriginal => {
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...(await importOriginal<object>()),
        modelFor: () =>
            new MockLanguageModelV3({
                doGenerate: async () => {
                    state.prompts += 1
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

afterEach(() => {
    state.prompts = 0
    delete process.env.RERUN_COMPACT_AT_SMALL
})

function custom(contextWindow?: number) {
    return { id: 'c1', config: { contextWindow } } as never
}

describe('effectiveCompactAt', () => {
    it('takes the class point on a window that holds it, and the window minus the reserve on a window that does not', () => {
        expect(effectiveCompactAt('small', 'custom', 'm', custom(262144))).toBe(229144)
        expect(effectiveCompactAt('large', 'custom', 'm', custom(262144))).toBe(229144)
        expect(effectiveCompactAt('small', 'custom', 'm', custom(524288))).toBe(240000)
        expect(effectiveCompactAt('large', 'custom', 'm', custom(524288))).toBe(491288)
        expect(effectiveCompactAt('large', 'custom', 'm', custom(1048576))).toBe(940000)
    })

    it('keeps the class point on a model whose window is unknown, and clamps a custom endpoint to its default window', () => {
        expect(effectiveCompactAt('large', 'openai', 'no-such-model')).toBe(940000)
        expect(effectiveCompactAt('large', 'custom', 'm', custom())).toBe(Math.min(940000, CUSTOM_DEFAULT_CONTEXT_WINDOW - 33000))
    })

    it('stays off when the size is off and reads the class point from the environment', () => {
        expect(effectiveCompactAt('off', 'custom', 'm', custom(262144))).toBeNull()
        process.env.RERUN_COMPACT_AT_SMALL = '150000'
        expect(effectiveCompactAt(undefined, 'openai', 'no-such-model')).toBe(150000)
    })
})

const ctx = { agent: { id: 'a', resolved: { provider: 'openai', model: 'm', connection: null } }, sessionId: 's', logger: { error: () => {} } } as never

function text(role: 'user' | 'assistant', length: number): Message {
    return { role, content: [{ type: 'text', text: 'x'.repeat(length) }] } as Message
}

const TAIL = [text('user', 20_000), text('assistant', 20_000), text('user', 20_000), text('assistant', 20_000)]

describe('stepContextGuard', () => {
    it('leaves a step under the point alone', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, 30_000, e => events.push(e))
        expect(await guard([text('user', 100), ...TAIL.slice(0, 2)])).toBeUndefined()
        expect(events).toEqual([])
    })

    it('prunes old tool outputs first and counts that once', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, 30_000, e => events.push(e))
        const messages: Message[] = [
            text('user', 100),
            { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: {} }] } as Message,
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'shell_exec', output: { type: 'text', value: 'y'.repeat(100_000) } }] } as Message,
            text('assistant', 100),
            ...TAIL,
        ]
        const first = await guard(messages)
        expect(JSON.stringify(first)).toContain('[pruned] shell_exec')
        await guard(messages)
        expect(events).toEqual([{ trigger: 'prune', summaryChars: 0 }])
        expect(state.prompts).toBe(0)
    })

    it('summarises the middle when pruning is not enough, once, and keeps using that summary on later steps', async () => {
        const events: unknown[] = []
        const guard = stepContextGuard(ctx, undefined, 'system', 0, 30_000, e => events.push(e))
        const messages: Message[] = [text('user', 100_000), text('assistant', 100), ...TAIL]
        const first = (await guard(messages))!
        expect(first[0]).toMatchObject({ role: 'user' })
        expect(JSON.stringify(first[0])).toContain('Condensed.')
        expect(first).toHaveLength(1 + TAIL.length)

        const next = text('user', 50)
        const second = (await guard([...messages, next]))!
        expect(second[0]).toEqual(first[0])
        expect(second.at(-1)).toEqual(next)
        expect(state.prompts).toBe(1)
        expect(events).toEqual([{ trigger: 'summary', summaryChars: 'Condensed.'.length }])
    })
})
