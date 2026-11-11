import { describe, expect, it } from 'vitest'
import { DEFAULT_CONNECTION_MODELS, MODEL_CONTEXT_WINDOW, MODEL_LABEL, OPENCODE_SNAPSHOT, isFreeOpencodeModel, isPremiumModel, providerSchema, trialModelFor } from '@rerun/contracts'
import { ENGINE_MODEL_CATALOG, catalogFor } from './models'

describe('ENGINE_MODEL_CATALOG', () => {
    // The engine seeds a new connection from DEFAULT_CONNECTION_MODELS and has no way to read this
    // catalog; the catalog carries the labels and power ratings the engine has no use for. Two
    // files, one list of ids — if they drift, a connection offers a model the picker cannot name,
    // or hides one it should show.
    // OpenCode is the one exception: a new connection gets the Go models switched on, and its catalog
    // also lists the Console ones, which start off (see the OpenCode block below).
    it('offers exactly the ids a new connection is seeded with', () => {
        for (const provider of providerSchema.options.filter(p => p !== 'opencode')) {
            const group = ENGINE_MODEL_CATALOG.find(g => g.provider === provider)
            expect(group?.models.map(m => m.id) ?? [], `catalog for ${provider}`).toEqual(DEFAULT_CONNECTION_MODELS[provider])
        }
    })

    // A label missing from the contract is not a crash, it is a picker row reading `gpt-5.6-sol`
    // where every other row reads like a product name. The iOS chip has no catalog to fall back on.
    it('names every id it offers', () => {
        for (const { models } of ENGINE_MODEL_CATALOG) {
            for (const { id } of models) expect(MODEL_LABEL[id], `label for ${id}`).toBeDefined()
        }
    })

    it('answers for a provider it has never heard of', () => {
        const unknown = catalogFor('some-future-provider')
        expect(unknown.models).toEqual([])
        expect(unknown.label).toBe('some-future-provider')
    })
})

describe('the OpenCode catalog', () => {
    const catalog = catalogFor('opencode').models.map(m => m.id)

    it('lists every model of the snapshot, Go before Console', () => {
        expect([...catalog].sort()).toEqual(OPENCODE_SNAPSHOT.map(m => m.id).sort())
        const firstConsole = catalog.findIndex(id => id.startsWith('console/'))
        expect(catalog.slice(0, firstConsole).every(id => id.startsWith('go/'))).toBe(true)
        expect(catalog.slice(firstConsole).every(id => id.startsWith('console/'))).toBe(true)
    })

    // A free Go model is listed, so a picker can name one a member switched on, but it is not
    // seeded: free endpoints can train on what they are sent.
    it('switches on the paid Go models alone, DeepSeek V4 Pro first', () => {
        expect(DEFAULT_CONNECTION_MODELS.opencode[0]).toBe('go/deepseek-v4-pro')
        expect([...DEFAULT_CONNECTION_MODELS.opencode].sort()).toEqual(
            OPENCODE_SNAPSHOT.filter(m => m.plan === 'go' && !isFreeOpencodeModel(m.price))
                .map(m => m.id)
                .sort(),
        )
        expect(catalog).toContain('go/beam-free')
        expect(DEFAULT_CONNECTION_MODELS.opencode).not.toContain('go/beam-free')
    })

    it('has a window and a label for every id, so compaction and the pickers work', () => {
        for (const id of catalog) {
            expect(MODEL_CONTEXT_WINDOW[id], id).toBeGreaterThan(0)
            expect(MODEL_LABEL[id], id).toBeDefined()
        }
    })
})

describe('premium models on a trial', () => {
    const premium = [
        ...providerSchema.options.flatMap(provider => DEFAULT_CONNECTION_MODELS[provider].filter(isPremiumModel).map(model => ({ provider, model }))),
        ...OPENCODE_SNAPSHOT.filter(m => isPremiumModel(m.id)).map(m => ({ provider: 'opencode' as const, model: m.id })),
    ]

    it('covers Opus, Fable and Astra, and leaves Sonnet and Sol open', () => {
        expect(premium.map(p => p.model)).toEqual(expect.arrayContaining(['console/claude-opus-5-5', 'console/gpt-6-astra', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-4-8[1m]', 'gpt-6-astra', 'openai/gpt-6-astra', 'anthropic/claude-opus-5.5']))
        for (const model of ['claude-sonnet-5[1m]', 'claude-haiku-4-5', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-6-luna', 'rerun-smart']) expect(isPremiumModel(model), model).toBe(false)
    })

    // The box runs the substitute without asking the connection, so it has to be a model the
    // provider knows and the compaction has a window for.
    it('steps every premium model down to one the same connection offers', () => {
        for (const { provider, model } of premium) {
            const substitute = trialModelFor(provider, model)
            expect(isPremiumModel(substitute), `${provider}:${model}`).toBe(false)
            expect(provider === 'opencode' ? catalogFor('opencode').models.map(m => m.id) : DEFAULT_CONNECTION_MODELS[provider], `${provider}:${model}`).toContain(substitute)
            expect(MODEL_CONTEXT_WINDOW[substitute], substitute).toBeDefined()
        }
    })
})
