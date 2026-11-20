import { describe, expect, it } from 'vitest'
import { connectionSummarySchema } from '@moldwright/contracts'
import { isModelEnabled, offeredModels } from '@/lib/engine/ai-sources'
import { catalogFor } from '@/lib/engine/models'

const openrouter = (discoveredModels: unknown) =>
    connectionSummarySchema.parse({
        id: 'cnx-router',
        name: 'OpenRouter',
        provider: 'openrouter',
        models: ['anthropic/claude-opus-5.5', 'x-ai/grok-4.7'],
        createdAt: '',
        connected: true,
        discoveredModels,
    })

describe('the models of a key connection with a live list', () => {
    const connection = openrouter([
        { id: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon', contextWindow: 2_000_000, price: { input: 2.5, output: 15, cacheRead: null } },
        { id: 'anthropic/claude-opus-5.5', label: 'Anthropic: Claude Opus 5.5', contextWindow: 1_000_000 },
    ])

    it('are what the provider listed, new ones off, and an enabled id it no longer lists still shown', () => {
        expect(offeredModels(connection).map(model => [model.id, isModelEnabled(connection, model.id)])).toEqual([
            ['google/gemini-4-carbon', false],
            ['anthropic/claude-opus-5.5', true],
            ['x-ai/grok-4.7', true],
        ])
    })

    it('keep the known label and bars, and take the provider name with no bars for a new id', () => {
        const [carbon, opus] = offeredModels(connection)
        const known = catalogFor('openrouter').models.find(model => model.id === 'anthropic/claude-opus-5.5')
        expect(carbon).toEqual({ id: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon', power: undefined })
        expect(opus).toEqual(known)
    })

    it('fall back on the fixed list while no live list has arrived', () => {
        expect(offeredModels(openrouter(null)).map(model => model.id).slice(0, catalogFor('openrouter').models.length)).toEqual(catalogFor('openrouter').models.map(model => model.id))
    })
})
