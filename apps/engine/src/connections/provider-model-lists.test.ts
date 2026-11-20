import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anthropicNextPage, googleNextPage, parseAnthropicModels, parseGoogleModels, parseOpenaiModels, parseOpenrouterModels } from './provider-model-lists.js'

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(import.meta.dirname, '__fixtures__/provider-models', `${name}.json`), 'utf8'))

describe('parseOpenrouterModels', () => {
    it('keeps text models with their name, window and price per million tokens', () => {
        expect(parseOpenrouterModels(fixture('openrouter'))).toEqual([
            { id: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon', contextWindow: 2_000_000, price: { input: 2.5, output: 15, cacheRead: 0.625 } },
            { id: 'anthropic/claude-opus-5.5', label: 'Anthropic: Claude Opus 5.5', contextWindow: 1_000_000, price: { input: 5, output: 25, cacheRead: null } },
            { id: 'openrouter/auto', label: 'Auto Router', contextWindow: 2_000_000 },
        ])
    })

    it('cuts a long name and drops a window too small or too large to be real', () => {
        const [row] = parseOpenrouterModels({ data: [{ id: 'a/long', name: 'n'.repeat(500), context_length: 4095 }, { id: 'a/huge', context_length: 10_000_001 }, { id: 'a/edge', context_length: 4096 }] })
        expect(row.label).toHaveLength(200)
        expect(row.contextWindow).toBeNull()
        expect(parseOpenrouterModels({ data: [{ id: 'a/huge', context_length: 10_000_001 }] })[0].contextWindow).toBeNull()
        expect(parseOpenrouterModels({ data: [{ id: 'a/edge', context_length: 4096 }] })[0].contextWindow).toBe(4096)
    })

    it('reads nothing from a body that is not a model list', () => {
        expect(parseOpenrouterModels('garbage')).toEqual([])
        expect(parseOpenrouterModels({ data: 'nope' })).toEqual([])
    })
})

describe('parseOpenaiModels', () => {
    it('keeps only the chat models', () => {
        expect(parseOpenaiModels(fixture('openai'))).toEqual([
            { id: 'gpt-6-sol', contextWindow: null },
            { id: 'gpt-7-preview', contextWindow: null },
        ])
    })
})

describe('parseGoogleModels', () => {
    it('keeps text models that generate content, without the models/ prefix', () => {
        expect(parseGoogleModels(fixture('google-page1'))).toEqual([{ id: 'gemini-4-argon', label: 'Gemini 4 Argon', contextWindow: 1_048_576 }])
        expect(parseGoogleModels(fixture('google-page2'))).toEqual([{ id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', contextWindow: 2_097_152 }])
    })

    it('follows the page token until there is none', () => {
        expect(googleNextPage(fixture('google-page1'))).toBe('page-2')
        expect(googleNextPage(fixture('google-page2'))).toBeNull()
    })
})

describe('parseAnthropicModels', () => {
    it('reads the id, display name and the window when the list gives one', () => {
        expect(parseAnthropicModels(fixture('anthropic-page1'))).toEqual([
            { id: 'claude-opus-6', label: 'Claude Opus 6', contextWindow: 1_000_000 },
            { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextWindow: null },
        ])
    })

    it('pages after the last id while has_more is set', () => {
        expect(anthropicNextPage(fixture('anthropic-page1'))).toBe('claude-sonnet-5-5')
        expect(anthropicNextPage(fixture('anthropic-page2'))).toBeNull()
    })
})
