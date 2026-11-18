import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedText, embedTextShared } from './embed'

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: vi.fn(() => ({ textEmbeddingModel: vi.fn(() => 'embedding-model') })),
}))

vi.mock('ai', () => ({ embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })) }))

const originalEmbedKey = process.env.RERUN_EMBED_API_KEY
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY

describe('embedText', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.OPENROUTER_API_KEY = 'max-key'
        process.env.RERUN_EMBED_API_KEY = 'embedding-key'
    })

    afterEach(() => {
        if (originalEmbedKey === undefined) delete process.env.RERUN_EMBED_API_KEY
        else process.env.RERUN_EMBED_API_KEY = originalEmbedKey
        if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
        else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    })

    it('uses the dedicated embedding key when the Rerun key is also configured', async () => {
        await expect(embedText('hello')).resolves.toEqual([0.1, 0.2])

        expect(createOpenAICompatible).toHaveBeenCalledWith({
            name: 'openrouter',
            apiKey: 'embedding-key',
            baseURL: 'https://openrouter.ai/api/v1',
        })
    })

    it('does not fall back to the Rerun key', async () => {
        delete process.env.RERUN_EMBED_API_KEY

        await expect(embedText('hello')).resolves.toBeNull()
        expect(createOpenAICompatible).not.toHaveBeenCalled()
    })

    // The model refuses past 8192 tokens: a long memory used to come back as a 500 and no vector.
    it('embeds only the head of a text too long for the model', async () => {
        await embedText('a'.repeat(40_000))

        const value = (vi.mocked(embed).mock.calls[0]?.[0] as { value: string }).value
        expect(value.length).toBe(16_000)
    })

    // JSON and code spend about one token for every two characters, CJK text about one per character.
    it('still gets a vector for text that spends more tokens than prose', async () => {
        vi.mocked(embed).mockImplementation(async ({ value }) => {
            const tokens = /[\u3040-\u9fff]/.test(value) ? value.length : value.length / 2
            if (tokens > 8192) throw new Error("This model's maximum input length is 8192 tokens.")
            return { embedding: [0.3] } as never
        })

        await expect(embedText('{"a":1}'.repeat(6000))).resolves.toEqual([0.3])
        await expect(embedText('記憶'.repeat(20_000))).resolves.toEqual([0.3])
    })
})

// The hub asks for the embedding of a message as it comes in, and the engine asks for the same one a
// moment later to recall its memories: the second ask joins the first.
describe('embedTextShared', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(embed).mockImplementation(async () => ({ embedding: [0.1, 0.2] }) as never)
        process.env.RERUN_EMBED_API_KEY = 'embedding-key'
    })

    afterEach(() => {
        vi.useRealTimers()
        if (originalEmbedKey === undefined) delete process.env.RERUN_EMBED_API_KEY
        else process.env.RERUN_EMBED_API_KEY = originalEmbedKey
    })

    it('asks the provider once for a text asked for twice by the same workspace, while it runs and once it has landed', async () => {
        let land!: (value: { embedding: number[] }) => void
        vi.mocked(embed).mockImplementation(() => new Promise(resolve => (land = resolve as never)) as never)

        const fromTheHub = embedTextShared(7, 'what did we decide on pricing?')
        const fromTheEngine = embedTextShared(7, 'what did we decide on pricing?')
        land({ embedding: [0.5] })

        await expect(fromTheHub).resolves.toEqual([0.5])
        await expect(fromTheEngine).resolves.toEqual([0.5])
        await expect(embedTextShared(7, 'what did we decide on pricing?')).resolves.toEqual([0.5])
        expect(embed).toHaveBeenCalledTimes(1)
    })

    it('keeps the workspaces and the texts apart', async () => {
        await embedTextShared(7, 'shared text one')
        await embedTextShared(8, 'shared text one')
        await embedTextShared(7, 'shared text two')

        expect(embed).toHaveBeenCalledTimes(3)
    })

    it('asks again after a failure, and after a provider that answered nothing', async () => {
        vi.mocked(embed).mockRejectedValueOnce(new Error('provider away'))
        await expect(embedTextShared(7, 'retried after a failure')).rejects.toThrow('provider away')
        await expect(embedTextShared(7, 'retried after a failure')).resolves.toEqual([0.1, 0.2])
        expect(embed).toHaveBeenCalledTimes(2)

        delete process.env.RERUN_EMBED_API_KEY
        await expect(embedTextShared(7, 'no key yet')).resolves.toBeNull()
        process.env.RERUN_EMBED_API_KEY = 'embedding-key'
        await expect(embedTextShared(7, 'no key yet')).resolves.toEqual([0.1, 0.2])
    })

    it('asks again once the moment has passed', async () => {
        vi.useFakeTimers()
        await embedTextShared(7, 'asked again later')
        vi.advanceTimersByTime(31_000)
        await embedTextShared(7, 'asked again later')

        expect(embed).toHaveBeenCalledTimes(2)
    })
})
