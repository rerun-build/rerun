import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedText } from './embed'

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

    it('uses the dedicated embedding key when the Moldwright key is also configured', async () => {
        await expect(embedText('hello')).resolves.toEqual([0.1, 0.2])

        expect(createOpenAICompatible).toHaveBeenCalledWith({
            name: 'openrouter',
            apiKey: 'embedding-key',
            baseURL: 'https://openrouter.ai/api/v1',
        })
    })

    it('does not fall back to the Moldwright key', async () => {
        delete process.env.RERUN_EMBED_API_KEY

        await expect(embedText('hello')).resolves.toBeNull()
        expect(createOpenAICompatible).not.toHaveBeenCalled()
    })

    it('embeds only the head of a text too long for the model', async () => {
        await embedText('a'.repeat(40_000))

        const value = (vi.mocked(embed).mock.calls[0]?.[0] as { value: string }).value
        expect(value.length).toBe(16_000)
    })

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
