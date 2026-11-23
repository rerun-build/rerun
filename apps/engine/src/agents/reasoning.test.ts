import { describe, expect, it } from 'vitest'
import { acceptsReasoningEffort, agentConfigSchema } from '@rerun/contracts'
import { applyCaching } from './caching.js'
import { effortProviderOptions, mergeProviderOptions, reasoningProviderOptions, runEffort } from './reasoning.js'

describe('reasoning provider options on OpenCode', () => {
    it('asks the way the format asks, and nothing on the chat format', () => {
        expect(reasoningProviderOptions('opencode', 'go/claude-haiku-5-5')).toEqual(reasoningProviderOptions('anthropic'))
        expect(reasoningProviderOptions('opencode', 'go/gpt-6-luna')).toEqual(reasoningProviderOptions('openai'))
        expect(reasoningProviderOptions('opencode', 'go/gemini-4-argon')).toEqual(reasoningProviderOptions('google'))
        expect(reasoningProviderOptions('opencode', 'go/deepseek-v4-pro')).toBeUndefined()
        expect(reasoningProviderOptions('opencode', 'go/unknown')).toBeUndefined()
    })

    it.each(['console/claude-haiku-4-5', 'console/claude-sonnet-4-5', 'console/claude-opus-4-5'])('asks no thinking of %s', model => {
        expect(reasoningProviderOptions('opencode', model)).toBeUndefined()
    })

    it.each(['console/claude-opus-4-6', 'console/claude-sonnet-4-6', 'console/claude-opus-5-5', 'go/qwen3.8-max'])('still asks %s', model => {
        expect(reasoningProviderOptions('opencode', model)).toEqual(reasoningProviderOptions('anthropic'))
    })
})

describe('reasoning provider options', () => {
    it('asks each API provider for its reasoning in its own dialect', () => {
        expect(reasoningProviderOptions('anthropic')).toEqual({ anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } })
        expect(reasoningProviderOptions('openai')).toEqual({ openai: { reasoningSummary: 'auto' } })
        expect(reasoningProviderOptions('google')).toEqual({ google: { thinkingConfig: { includeThoughts: true } } })
    })

    it.each(['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101'])('asks no thinking of %s, which refuses adaptive', model => {
        expect(reasoningProviderOptions('anthropic', model)).toBeUndefined()
    })

    it.each(['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'])('asks %s for adaptive thinking', model => {
        expect(reasoningProviderOptions('anthropic', model)).toEqual({ anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } })
    })

    it('leaves the providers that are configured elsewhere alone', () => {
        // The two CLIs take it through `defaultSettings`, the two OpenRouter ones through the body.
        expect(reasoningProviderOptions('claude')).toBeUndefined()
        expect(reasoningProviderOptions('codex')).toBeUndefined()
        expect(reasoningProviderOptions('rerun')).toBeUndefined()
        expect(reasoningProviderOptions('openrouter')).toBeUndefined()
    })

    it('keeps the prompt cache key when both write under the same provider', () => {
        const cached = applyCaching('openai', { system: { stable: 'be useful', volatile: '' }, messages: [], sessionId: 'session-1' })

        expect(mergeProviderOptions(cached.providerOptions, { openai: { reasoningSummary: 'auto' } })).toEqual({
            openai: { promptCacheKey: 'session-1', reasoningSummary: 'auto' },
        })
    })

    it('merges when either side is missing', () => {
        expect(mergeProviderOptions(undefined, { openai: { reasoningSummary: 'auto' } })).toEqual({ openai: { reasoningSummary: 'auto' } })
        expect(mergeProviderOptions({ openai: { promptCacheKey: 'session-1' } }, undefined)).toEqual({ openai: { promptCacheKey: 'session-1' } })
        expect(mergeProviderOptions(undefined, undefined)).toBeUndefined()
    })

    it('does not touch the anthropic cache breakpoints, which may never land on a thinking block', () => {
        const cached = applyCaching('anthropic', { system: { stable: 'be useful', volatile: '' }, messages: [{ role: 'user', content: 'hi' }], sessionId: 'session-1' })
        const merged = mergeProviderOptions(cached.providerOptions, reasoningProviderOptions('anthropic'))

        expect(merged).toEqual({ anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } })
        expect(cached.messages.filter(m => m.providerOptions?.anthropic)).toHaveLength(1)
        expect(cached.messages.at(-1)?.role).toBe('user')
    })
})

describe('which models take an effort', () => {
    it('lets the API and subscription models pick one, never the Rerun tiers nor OpenCode', () => {
        expect(acceptsReasoningEffort('claude', 'claude-opus-5-5')).toBe(true)
        expect(acceptsReasoningEffort('anthropic', 'claude-sonnet-5-5')).toBe(true)
        expect(acceptsReasoningEffort('claude', 'claude-haiku-4-5')).toBe(false)
        expect(acceptsReasoningEffort('anthropic', 'claude-haiku-4-5-20251001')).toBe(false)
        expect(acceptsReasoningEffort('codex', 'gpt-6-sol')).toBe(true)
        expect(acceptsReasoningEffort('openai', 'gpt-6.2-astra')).toBe(true)
        expect(acceptsReasoningEffort('google', 'gemini-4-argon')).toBe(true)
        expect(acceptsReasoningEffort('openrouter', 'anthropic/claude-opus-5.5')).toBe(true)
        expect(acceptsReasoningEffort('openrouter', 'moonshotai/kimi-k3.1-pro')).toBe(false)
        expect(acceptsReasoningEffort('rerun', 'rerun-fast')).toBe(false)
        expect(acceptsReasoningEffort('opencode', 'go/kimi-k3')).toBe(false)
        expect(acceptsReasoningEffort('custom', 'gpt-6-sol')).toBe(false)
    })
})

describe('the effort of a run', () => {
    const agent = { config: agentConfigSchema.parse({ name: 'ada', provider: 'claude', model: 'claude-opus-5-5', effort: 'high' }) }

    it('takes the conversation pick first, null included', () => {
        expect(runEffort(agent, { model: 'claude-opus-5-5', effort: 'low' }, 'claude', 'claude-opus-5-5')).toBe('low')
        expect(runEffort(agent, { model: 'claude-opus-5-5', effort: null }, 'claude', 'claude-opus-5-5')).toBeNull()
    })

    it("falls back to the agent's effort only on the model it was picked for", () => {
        expect(runEffort(agent, undefined, 'claude', 'claude-opus-5-5')).toBe('high')
        expect(runEffort(agent, { model: 'claude-opus-5-5' }, 'claude', 'claude-opus-5-5')).toBe('high')
        // A backup or a routine pinned elsewhere runs on its own model's default.
        expect(runEffort(agent, { model: 'gpt-6-sol' }, 'codex', 'gpt-6-sol')).toBeNull()
    })

    it('never sends one to a model that takes none', () => {
        expect(runEffort(agent, { model: 'rerun-fast', effort: 'high' }, 'rerun', 'rerun-fast')).toBeNull()
    })
})

describe('effort provider options', () => {
    it('asks each API in its own words', () => {
        expect(effortProviderOptions('anthropic', 'high')).toEqual({ anthropic: { effort: 'high' } })
        expect(effortProviderOptions('openai', 'low')).toEqual({ openai: { reasoningEffort: 'low', forceReasoning: true } })
        expect(effortProviderOptions('google', 'medium')).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'medium' } } })
        expect(effortProviderOptions('codex', 'high')).toEqual({ 'codex-app-server': { effort: 'high' } })
    })

    it('adds nothing on Default, so the request stays the one sent before', () => {
        for (const provider of ['anthropic', 'openai', 'google', 'codex', 'claude', 'openrouter', 'rerun'] as const) {
            expect(effortProviderOptions(provider, null)).toBeUndefined()
            const today = reasoningProviderOptions(provider)
            expect(mergeProviderOptions(today, effortProviderOptions(provider, null))).toEqual(today)
        }
    })

    it('keeps the reasoning summary and the Codex thread beside the effort', () => {
        const google = mergeProviderOptions(reasoningProviderOptions('google'), effortProviderOptions('google', 'high'))
        expect(google).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } } })
        const codex = mergeProviderOptions(effortProviderOptions('codex', 'low'), { 'codex-app-server': { threadId: 't-1' } })
        expect(codex).toEqual({ 'codex-app-server': { effort: 'low', threadId: 't-1' } })
    })
})
