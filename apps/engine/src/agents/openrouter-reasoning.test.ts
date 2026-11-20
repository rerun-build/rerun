import { describe, expect, it } from 'vitest'
import { chunkReasoningDelta, openrouterReasoningMiddleware, reasoningFetch, reasoningFetchFor, responseReasoning } from './openrouter-reasoning.js'

const chunk = (delta: Record<string, unknown>) => ({ type: 'raw', rawValue: { choices: [{ index: 0, delta }] } })

const streamOf = async (parts: unknown[]) => {
    const wrapStream = openrouterReasoningMiddleware.wrapStream!
    const result = await wrapStream({
        doStream: async () => ({
            stream: new ReadableStream({
                start(controller) {
                    for (const part of parts) controller.enqueue(part)
                    controller.close()
                },
            }),
        }),
    } as any)
    const out: any[] = []
    for await (const part of result.stream) out.push(part)
    return out
}

describe('OpenRouter reasoning', () => {
    it('reads the reasoning of a chunk under either key', () => {
        expect(chunkReasoningDelta({ choices: [{ delta: { reasoning: 'Let me' } }] })).toBe('Let me')
        expect(chunkReasoningDelta({ choices: [{ delta: { reasoning_content: 'Let me' } }] })).toBe('Let me')
        expect(chunkReasoningDelta({ choices: [{ delta: { content: 'answer' } }] })).toBeUndefined()
        expect(chunkReasoningDelta({ choices: [{ delta: { reasoning: '' } }] })).toBeUndefined()
    })

    it('survives a raw value that is not a chunk', () => {
        expect(chunkReasoningDelta('[DONE]')).toBeUndefined()
        expect(chunkReasoningDelta(null)).toBeUndefined()
        expect(chunkReasoningDelta({ error: { message: 'nope' } })).toBeUndefined()
        expect(chunkReasoningDelta({ choices: 'not an array' })).toBeUndefined()
    })

    it('turns raw reasoning into a single block of reasoning parts', async () => {
        const parts = await streamOf([{ type: 'stream-start', warnings: [] }, chunk({ reasoning: 'Let me' }), chunk({ reasoning: ' think' })])

        expect(parts.filter(p => p.type.startsWith('reasoning'))).toEqual([
            { type: 'reasoning-start', id: 'reasoning-0' },
            { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Let me' },
            { type: 'reasoning-delta', id: 'reasoning-0', delta: ' think' },
            { type: 'reasoning-end', id: 'reasoning-0' },
        ])
    })

    it('closes the block on the first word of the answer', async () => {
        const parts = await streamOf([chunk({ reasoning: 'Let me' }), { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'hi' }])

        expect(parts.map(p => p.type)).toEqual(['reasoning-start', 'reasoning-delta', 'raw', 'text-start', 'reasoning-end', 'text-delta'])
    })

    // OpenRouter puts `content: ""` next to every reasoning delta, so the chat model opens its text
    // block and emits an empty text delta between two thoughts. Taking those for the answer cut one
    // thought into one collapsed block per chunk.
    it('keeps one block across the empty text deltas that shadow a thought', async () => {
        const parts = await streamOf([
            chunk({ reasoning: 'Let me', content: '' }),
            { type: 'text-start', id: '0' },
            { type: 'text-delta', id: '0', delta: '' },
            chunk({ reasoning: ' think', content: '' }),
            { type: 'text-delta', id: '0', delta: '' },
            { type: 'text-delta', id: '0', delta: 'Nine.' },
        ])

        expect(parts.filter(p => p.type.startsWith('reasoning')).map(p => p.type)).toEqual(['reasoning-start', 'reasoning-delta', 'reasoning-delta', 'reasoning-end'])
        expect(parts.at(-1)).toEqual({ type: 'text-delta', id: '0', delta: 'Nine.' })
    })

    it('closes the block before a tool call', async () => {
        const parts = await streamOf([chunk({ reasoning: 'I need the weather' }), { type: 'tool-input-start', id: '0', toolName: 'get_weather' }])

        expect(parts.map(p => p.type)).toEqual(['reasoning-start', 'reasoning-delta', 'raw', 'reasoning-end', 'tool-input-start'])
    })

    it('leaves a turn without reasoning untouched', async () => {
        const input = [{ type: 'text-start', id: '0' }, chunk({ content: 'hi' }), { type: 'text-delta', id: '0', delta: 'hi' }, { type: 'finish' }]

        expect(await streamOf(input)).toEqual(input)
    })

    it('reads the reasoning of a non-streamed response', () => {
        expect(responseReasoning({ choices: [{ message: { reasoning: 'Let me think', content: 'hi' } }] })).toBe('Let me think')
        expect(responseReasoning({ choices: [{ message: { content: 'hi' } }] })).toBeUndefined()
        expect(responseReasoning(undefined)).toBeUndefined()
    })

    it('asks OpenRouter for the reasoning, without overriding a caller that already did', async () => {
        const sent: string[] = []
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
            sent.push(String(init?.body))
            return new Response('{}')
        }) as typeof fetch

        try {
            await reasoningFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'qwen' }) })
            await reasoningFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'qwen', reasoning: { effort: 'high' } }) })
            await reasoningFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: 'not json' })
        } finally {
            globalThis.fetch = original
        }

        expect(JSON.parse(sent[0])).toEqual({ model: 'qwen', reasoning: { enabled: true }, usage: { include: true } })
        expect(JSON.parse(sent[1])).toEqual({ model: 'qwen', reasoning: { effort: 'high' }, usage: { include: true } })
        expect(sent[2]).toBe('not json')
    })

    it("asks for the agent's effort when one is picked, and exactly what it asked before when none is", async () => {
        const sent: string[] = []
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
            sent.push(String(init?.body))
            return new Response('{}')
        }) as typeof fetch

        try {
            await reasoningFetchFor('high')('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'anthropic/claude-opus-5.5' }) })
            await reasoningFetchFor(null)('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'anthropic/claude-opus-5.5' }) })
        } finally {
            globalThis.fetch = original
        }

        expect(JSON.parse(sent[0])).toEqual({ model: 'anthropic/claude-opus-5.5', reasoning: { effort: 'high' }, usage: { include: true } })
        expect(JSON.parse(sent[1])).toEqual({ model: 'anthropic/claude-opus-5.5', reasoning: { enabled: true }, usage: { include: true } })
    })

    // The usage frame is the last chunk of the stream, after the one carrying the finish reason:
    // its cost and its cache writes land on the finish part, where the run loop reads them.
    it('grafts the cost and the cache writes of the usage frame onto the finish part', async () => {
        const usageFrame = { type: 'raw', rawValue: { choices: [], usage: { prompt_tokens: 2723, cost: 0.0001, cost_details: { upstream_inference_cost: 0.0005 }, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 2719 } } } }
        const finish = { type: 'finish', finishReason: 'stop', usage: { inputTokens: 2723, inputTokenDetails: { noCacheTokens: 4, cacheReadTokens: 0, cacheWriteTokens: undefined } }, providerMetadata: { openai: {} } }
        const parts = await streamOf([chunk({ content: 'hi' }), usageFrame, finish])

        const out = parts.find(p => p.type === 'finish')
        expect(out.usage.inputTokenDetails.cacheWriteTokens).toBe(2719)
        expect(out.providerMetadata.openai).toEqual({})
        expect(out.providerMetadata.openrouter.usage.cost).toBeCloseTo(0.0006, 10)
    })

    it('leaves a finish part alone when no usage frame came', async () => {
        const finish = { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, inputTokenDetails: { noCacheTokens: 10 } } }
        const parts = await streamOf([chunk({ content: 'hi' }), finish])

        expect(parts.find(p => p.type === 'finish')).toEqual(finish)
    })

    it('reads the usage of a non-streamed response', async () => {
        const wrapGenerate = openrouterReasoningMiddleware.wrapGenerate!
        const result = await wrapGenerate({
            doGenerate: async () => ({ content: [], usage: { inputTokenDetails: {} }, response: { body: { choices: [{ message: { content: 'ok' } }], usage: { cost: 0.002, prompt_tokens_details: { cache_write_tokens: 40 } } } } }),
        } as any)

        expect((result as any).providerMetadata).toEqual({ openrouter: { usage: { cost: 0.002 } } })
        expect((result as any).usage.inputTokenDetails.cacheWriteTokens).toBe(40)
    })
})
