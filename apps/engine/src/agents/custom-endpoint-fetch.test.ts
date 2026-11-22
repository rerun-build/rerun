import { createOpenAI } from '@ai-sdk/openai'
import { APICallError, generateText, streamText, wrapLanguageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { customEndpointFetch } from './custom-endpoint-fetch.js'
import { opencodeChatReasoningMiddleware } from './opencode-stream.js'
import { classifyProviderError } from '../runtime/provider-errors.js'

const XAI_NO_CREDITS = 'Your team 4021a7 has either used all available credits or reached its monthly spending limit.'

function answering(status: number, body: string, statusText = '') {
    return vi.fn(async () => new Response(body, { status, statusText, headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } }))
}

async function refusalOf(inner: ReturnType<typeof answering>): Promise<unknown> {
    const provider = createOpenAI({ apiKey: 'k', baseURL: 'https://api.x.ai/v1', fetch: customEndpointFetch(inner as unknown as typeof fetch) })
    return generateText({ model: provider.chat('grok-4.7'), prompt: 'hi', maxRetries: 0 }).catch(error => error)
}

describe('customEndpointFetch', () => {
    it("keeps xAI's own sentence on a 402 instead of the bare status text", async () => {
        const error = await refusalOf(answering(402, JSON.stringify({ code: 'The caller does not have permission to execute the specified operation', error: XAI_NO_CREDITS }), 'Payment Required'))
        expect(APICallError.isInstance(error)).toBe(true)
        expect((error as Error).message).toBe(`Custom endpoint refused the request: ${XAI_NO_CREDITS}`)
        expect((error as APICallError).statusCode).toBe(402)
        expect(classifyProviderError('custom', error)).not.toBe('rerun_budget_exhausted')
    })

    it('names the status when the 402 has no body', async () => {
        const error = await refusalOf(answering(402, '', 'Payment Required'))
        expect((error as Error).message).toBe('Custom endpoint refused the request: Payment Required')
    })

    it('names the status when a proxy answers the 402 with a page', async () => {
        const error = await refusalOf(answering(402, '<!DOCTYPE html><html><body><h1>Payment required</h1></body></html>', 'Payment Required'))
        expect((error as Error).message).toBe('Custom endpoint refused the request: Payment Required')
    })

    it('keeps a long plain answer down to a sentence', async () => {
        const error = await refusalOf(answering(402, 'x'.repeat(5_000), 'Payment Required'))
        expect((error as Error).message).toBe(`Custom endpoint refused the request: ${'x'.repeat(500)}…`)
    })

    it('leaves any other answer untouched', async () => {
        const rateLimited = await customEndpointFetch(answering(429, '{"error":"slow down"}') as unknown as typeof fetch)('https://api.x.ai/v1/chat/completions')
        expect(rateLimited.status).toBe(429)
        expect(await rateLimited.text()).toBe('{"error":"slow down"}')

        const ok = await customEndpointFetch(answering(200, '{"ok":true}') as unknown as typeof fetch)('https://api.x.ai/v1/chat/completions')
        expect(await ok.text()).toBe('{"ok":true}')
    })

    it('waits as long as a slow local model needs', async () => {
        const inner = answering(200, '{}')
        await customEndpointFetch(inner as unknown as typeof fetch)('http://localhost:11434/v1/chat/completions')
        const init = (inner.mock.calls[0] as unknown as [string, RequestInit & { dispatcher?: unknown }])[1]
        expect(init.dispatcher).toBeDefined()
    })
})

const mistralChunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: 'c50a', object: 'chat.completion.chunk', created: 1795345903, model: 'mistral-large-latest', choices: [{ index: 0, delta, finish_reason: finish }], p: 'abcdef' })}\n\n`
const thinking = (text: string) => ({ type: 'thinking', thinking: [{ type: 'text', text }], closed: true })

// Chunks of a real `mistral-large-latest` stream (Mistral Large 4, 22/11/2026), shortened.
const MISTRAL_THINKING_STREAM = [
    mistralChunk({ role: 'assistant', content: '' }),
    mistralChunk({ content: [thinking('The user said hi.')] }),
    mistralChunk({ content: [thinking(' Let me go with "Hi there."')] }),
    mistralChunk({ content: [{ type: 'thinking', thinking: [] }, { type: 'text', text: 'Hi there.' }] }),
    mistralChunk({ content: '' }, 'stop'),
    'data: [DONE]\n\n',
].join('')

function streaming(sse: string) {
    const bytes = new TextEncoder().encode(sse)
    const cut = sse.indexOf('Let me go')
    return vi.fn(async () => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(bytes.slice(0, cut))
            controller.enqueue(bytes.slice(cut))
            controller.close()
        },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
}

function mistralModel(inner: ReturnType<typeof vi.fn>) {
    const provider = createOpenAI({ apiKey: 'k', baseURL: 'https://api.mistral.ai/v1', fetch: customEndpointFetch(inner as unknown as typeof fetch) })
    return wrapLanguageModel({ model: provider.chat('mistral-large-latest'), middleware: [opencodeChatReasoningMiddleware] })
}

describe('customEndpointFetch on a reasoning model that sends its content as parts', () => {
    it("streams Mistral's thinking as reasoning and its text as the answer", async () => {
        const result = streamText({ model: mistralModel(streaming(MISTRAL_THINKING_STREAM)), prompt: 'hi', maxRetries: 0 })
        let text = ''
        let reasoning = ''
        const errors: unknown[] = []
        for await (const part of result.fullStream) {
            if (part.type === 'text-delta') text += part.text
            else if (part.type === 'reasoning-delta') reasoning += part.text
            else if (part.type === 'error') errors.push(part.error)
        }
        expect(errors).toEqual([])
        expect(text).toBe('Hi there.')
        expect(reasoning).toBe('The user said hi. Let me go with "Hi there."')
    })

    it("reads the answer of a one-shot call out of Mistral's parts", async () => {
        const body = JSON.stringify({
            id: 'c50a', object: 'chat.completion', created: 1795345903, model: 'mistral-large-latest',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', tool_calls: null, content: [thinking('A short title.'), { type: 'text', text: 'Greeting' }] } }],
            usage: { prompt_tokens: 17, total_tokens: 30, completion_tokens: 13 },
        })
        const result = await generateText({ model: mistralModel(answering(200, body)), prompt: 'title', maxRetries: 0 })
        expect(result.text).toBe('Greeting')
    })

    it('passes a stream of plain strings through byte for byte', async () => {
        const sse = [mistralChunk({ role: 'assistant', content: 'Hel' }), mistralChunk({ content: 'lo', reasoning_content: 'hm' }, 'stop'), 'data: [DONE]\n\n'].join('')
        const response = await customEndpointFetch(streaming(sse) as unknown as typeof fetch)('https://api.deepseek.com/v1/chat/completions')
        expect(await response.text()).toBe(sse)
    })
})
