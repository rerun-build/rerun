import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { applyCaching, withTailBreakpoint } from './caching.js'

const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
const system = { stable: 'You are a test agent.', volatile: '<current_time>\nToday is Monday.\n</current_time>' }
const input = { system, messages, sessionId: 'session-1' }
const hour = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }

describe('applyCaching on OpenCode', () => {
    it('caches a model as the provider of its format does', () => {
        expect(applyCaching('opencode', { ...input, model: 'go/claude-haiku-5-5' })).toEqual(applyCaching('anthropic', input))
        expect(applyCaching('opencode', { ...input, model: 'go/gpt-6-luna' })).toEqual(applyCaching('openai', input))
        expect(applyCaching('opencode', { ...input, model: 'go/deepseek-v4-pro' })).toEqual(applyCaching('openrouter', input))
        expect(applyCaching('opencode', { ...input, model: 'go/gemini-4-argon' })).toEqual(applyCaching('google', input))
    })

    // The branches of the providers that were there before OpenCode do not move with it.
    it('leaves every other provider as it was', () => {
        for (const provider of ['anthropic', 'openai', 'openrouter', 'rerun', 'google', 'claude', 'codex'] as const) {
            expect(applyCaching(provider, { ...input, model: 'go/deepseek-v4-pro' }), provider).toEqual(applyCaching(provider, input))
        }
        expect(applyCaching('openrouter', input)).toMatchSnapshot()
        expect(applyCaching('anthropic', input)).toMatchSnapshot()
        expect(applyCaching('google', input)).toMatchSnapshot()
    })
})

describe('applyCaching', () => {
    it.each(['claude', 'codex'] as const)('drops the system prompt for %s, which takes it through its CLI settings', provider => {
        const out = applyCaching(provider, input)
        expect(out.system).toBeUndefined()
        expect(out.messages).toEqual(messages)
        expect(out.messages.some(m => m.role === 'system')).toBe(false)
    })

    it('gives anthropic one cached system message per block, for an hour, and a breakpoint on the tail', () => {
        const out = applyCaching('anthropic', input)
        expect(out.system).toEqual([
            { role: 'system', content: system.stable, providerOptions: hour },
            { role: 'system', content: system.volatile, providerOptions: hour },
        ])
        expect(out.messages).toEqual([{ role: 'user', content: 'hello', providerOptions: hour }])
        expect(out.providerOptions).toBeUndefined()
    })

    it.each(['rerun', 'openrouter', 'openai'] as const)('sends %s the two blocks as two plain system messages, marked on the wire by the hub or the fetch', provider => {
        const out = applyCaching(provider, input)
        expect(out.system).toEqual([
            { role: 'system', content: system.stable },
            { role: 'system', content: system.volatile },
        ])
        expect(out.messages).toBe(messages)
    })

    it.each(['openai', 'openrouter'] as const)('keeps the prompt cache key of the session for %s', provider => {
        expect(applyCaching(provider, input).providerOptions).toEqual({ openai: { promptCacheKey: 'session-1' } })
    })

    it('sends no provider options to rerun, the hub marks the prompt itself', () => {
        expect(applyCaching('rerun', input).providerOptions).toBeUndefined()
    })

    it('leaves an empty volatile block out', () => {
        expect(applyCaching('rerun', { ...input, system: { stable: 'solo', volatile: '' } }).system).toEqual([{ role: 'system', content: 'solo' }])
    })

    it('joins the blocks for google', () => {
        expect(applyCaching('google', input).system).toBe(`${system.stable}\n\n${system.volatile}`)
    })
})

describe('withTailBreakpoint', () => {
    it('moves the breakpoint to the last message and takes it off the one that had it', () => {
        const before = withTailBreakpoint([{ role: 'user', content: 'hi' }])
        expect(before[0].providerOptions).toEqual(hour)

        const after = withTailBreakpoint([...before, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', input: {} }] }, { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'fs_read', output: { type: 'text', value: 'x' } }] }])
        expect(after[0].providerOptions).toBeUndefined()
        expect(after[1].providerOptions).toBeUndefined()
        expect(after[2].providerOptions).toEqual(hour)
    })

    it('keeps the other provider options of a message', () => {
        const [first, last] = withTailBreakpoint([
            { role: 'user', content: 'a', providerOptions: { ...hour, openai: { x: 1 } } },
            { role: 'user', content: 'b' },
        ])
        expect(first.providerOptions).toEqual({ openai: { x: 1 } })
        expect(last.providerOptions).toEqual(hour)
    })
})
