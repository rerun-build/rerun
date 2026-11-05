import { describe, expect, it } from 'vitest'
import { cardCallTiming, turnOrder } from './turn-order.js'

describe('the order of a turn', () => {
    it('reads an OpenCode id without its plan', () => {
        expect(turnOrder('opencode', 'go/gpt-6-luna')).toBe('call-first')
        expect(turnOrder('opencode', 'console/gpt-5.5')).toBe('call-first')
        expect(turnOrder('opencode', 'go/deepseek-v4-pro')).toBe('message-first')
        expect(turnOrder('opencode', 'console/claude-sonnet-5-5')).toBe('call-first')
    })

    it.each([
        ['codex', 'gpt-6-sol'],
        ['rerun', 'openai/gpt-6-sol'],
        ['rerun', 'openai/gpt-6-luna'],
        ['openai', 'gpt-5.4'],
        ['openai', 'o4-mini'],
        ['openrouter', 'openai/gpt-6-sol'],
    ] as const)('puts the calls first on %s running %s', (provider, model) => {
        expect(turnOrder(provider, model)).toBe('call-first')
    })

    // A note a Claude writes right before a call comes back from the API as a thinking block the
    // chat folds away: its message has to come after the card, as the text that ends the turn.
    it.each([
        ['claude', 'claude-opus-5-5'],
        ['anthropic', 'claude-sonnet-5'],
        ['anthropic', 'claude-sonnet-5-5'],
        ['rerun', 'anthropic/claude-haiku-5.5'],
        ['openrouter', 'anthropic/claude-sonnet-5'],
        ['opencode', 'console/claude-opus-5-5'],
    ] as const)('puts the calls first on %s running %s, a Claude', (provider, model) => {
        expect(turnOrder(provider, model)).toBe('call-first')
    })

    it.each([
        ['rerun', 'rerun-smart'],
        ['openrouter', 'qwen/qwen3.8-flash'],
        ['openrouter', 'deepseek/deepseek-v4-pro'],
        ['google', 'gemini-3.5-flash'],
    ] as const)('puts the message first on %s running %s', (provider, model) => {
        expect(turnOrder(provider, model)).toBe('message-first')
    })

    it('tells a model that calls first that the card still shows below its message', () => {
        expect(cardCallTiming('call-first')).toContain('the card still shows below that message')
        expect(cardCallTiming('message-first')).not.toContain('below')
    })
})
