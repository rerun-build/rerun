import { describe, expect, it } from 'vitest'
import { agentConfigSchema, chatRequestSchema, type Provider } from '@rerun/contracts'
import { REASONING_REQUEST, reasoningFetchFor } from './openrouter-reasoning.js'
import { REASONING_OPTIONS } from './reasoning.js'
import { CLAUDE_DEFAULT_THINKING, thinkingSettingsFor } from './thinking.js'

const ALL: Provider[] = ['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter', 'opencode', 'custom']
const LEVELS = ['low', 'medium', 'high'] as const

describe('thinkingSettingsFor', () => {
    it.each(ALL)('null and undefined give today\'s constants for %s', (provider) => {
        const expected = {
            claudeThinking: provider === 'claude' ? CLAUDE_DEFAULT_THINKING : undefined,
            providerOptions: REASONING_OPTIONS[provider],
            openrouterReasoning: provider === 'rerun' || provider === 'openrouter' ? REASONING_REQUEST : undefined,
        }
        expect(thinkingSettingsFor(provider, 'm', null)).toEqual(expected)
        expect(thinkingSettingsFor(provider, 'm', undefined)).toEqual(expected)
    })

    it('keeps the Claude default literal', () => {
        expect(CLAUDE_DEFAULT_THINKING).toEqual({ type: 'adaptive', display: 'summarized' })
    })

    it.each(LEVELS)('maps %s per supported provider', (level) => {
        expect(thinkingSettingsFor('claude', 'm', level)).toEqual({ claudeThinking: { ...CLAUDE_DEFAULT_THINKING, effort: level } })
        expect(thinkingSettingsFor('anthropic', 'm', level)).toEqual({ providerOptions: { anthropic: { thinking: CLAUDE_DEFAULT_THINKING, effort: level } } })
        expect(thinkingSettingsFor('openai', 'm', level)).toEqual({ providerOptions: { openai: { reasoningSummary: 'auto', reasoningEffort: level } } })
        expect(thinkingSettingsFor('google', 'm', level)).toEqual({ providerOptions: { google: { thinkingConfig: { includeThoughts: true, thinkingLevel: level } } } })
        for (const p of ['openrouter', 'rerun'] as const) {
            expect(thinkingSettingsFor(p, 'm', level)).toEqual({ openrouterReasoning: { ...REASONING_REQUEST, effort: level } })
        }
    })

    it.each(['codex', 'opencode', 'custom'] as const)('unsupported %s returns the null result', (provider) => {
        for (const level of [null, ...LEVELS]) expect(thinkingSettingsFor(provider, 'm', level)).toEqual(thinkingSettingsFor(provider, 'm', null))
        expect(thinkingSettingsFor(provider, 'm', 'high')).toEqual({ providerOptions: undefined })
    })
})

describe('xhigh', () => {
    it('is accepted as the coworker level and as the level of one run', () => {
        expect(agentConfigSchema.safeParse({ name: 't', thinkingLevel: 'xhigh' }).success).toBe(true)
        expect(chatRequestSchema.safeParse({ message: 'hi', thinkingLevel: 'xhigh' }).success).toBe(true)
        expect(agentConfigSchema.safeParse({ name: 't', thinkingLevel: 'max' }).success).toBe(false)
        expect(chatRequestSchema.safeParse({ message: 'hi', thinkingLevel: 'max' }).success).toBe(false)
    })

    it('goes to claude and anthropic as xhigh', () => {
        expect(thinkingSettingsFor('claude', 'm', 'xhigh')).toEqual({ claudeThinking: { ...CLAUDE_DEFAULT_THINKING, effort: 'xhigh' } })
        expect(thinkingSettingsFor('anthropic', 'm', 'xhigh')).toEqual({ providerOptions: { anthropic: { thinking: CLAUDE_DEFAULT_THINKING, effort: 'xhigh' } } })
    })

    it('goes to every other provider as high', () => {
        for (const p of ['openai', 'google', 'rerun', 'openrouter'] as const) {
            expect(thinkingSettingsFor(p, 'm', 'xhigh')).toEqual(thinkingSettingsFor(p, 'm', 'high'))
        }
    })

    it('reaches the openrouter request as high', async () => {
        const sent: string[] = []
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => (sent.push(String(init?.body)), new Response('{}'))) as typeof fetch
        try {
            await reasoningFetchFor('xhigh')('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'qwen' }) })
        } finally {
            globalThis.fetch = original
        }
        expect(JSON.parse(sent[0]).reasoning).toEqual({ enabled: true, effort: 'high' })
    })
})
