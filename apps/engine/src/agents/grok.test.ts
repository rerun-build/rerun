import { readFileSync } from 'node:fs'
import { vi } from 'vitest'

const tokens = vi.hoisted(() => ({ refreshes: [] as (string | undefined)[], next: 'access-2' }))

vi.mock('../connections/grok-token.js', () => ({
    grokAccessToken: (connection: { env: Record<string, string> }) => connection.env.GROK_OAUTH_TOKEN,
    ensureGrokToken: async (connection: { env: Record<string, string> }, options: { rejectedToken?: string } = {}) => {
        if (options.rejectedToken === undefined) return
        tokens.refreshes.push(options.rejectedToken)
        connection.env.GROK_OAUTH_TOKEN = tokens.next
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { stepCountIs, streamText, tool, wrapLanguageModel } = await import('ai')
const { z } = await import('zod')
const { grokLanguageModel, grokVisionModel } = await import('./grok.js')
const { applyCaching } = await import('./caching.js')
const { effortProviderOptions, mergeProviderOptions, reasoningProviderOptions } = await import('./reasoning.js')
const { behaviourOf, modelSeesImages } = await import('./opencode.js')

const fixture = (step: number) => readFileSync(new URL(`./__fixtures__/grok/step-${step}.sse`, import.meta.url), 'utf8')

type Sent = { url: string; headers: Headers; body: Record<string, unknown> | null; redirect: RequestRedirect | undefined }

function grokConnection(token = 'access-1') {
    return { id: 'grokcnx', config: { name: 'Grok', provider: 'grok' as const, models: ['grok-4.5', 'grok-4.6'], extraModels: [], createdAt: '' }, env: { GROK_OAUTH_TOKEN: token } }
}

function proxy(answers: (() => Response)[]) {
    const sent: Sent[] = []
    const inner = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(input), headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null, redirect: init?.redirect })
        const answer = answers.shift()
        if (!answer) throw new Error('no answer left')
        return answer()
    })
    return { sent, inner: inner as unknown as typeof fetch }
}

const sse = (text: string) => () => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
const realFetch = globalThis.fetch

beforeEach(() => {
    tokens.refreshes = []
    tokens.next = 'access-2'
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('a Grok run on the Responses API', () => {
    it('plays three steps of real Grok streams through the loop with parallel tools and its reasoning carried back', async () => {
        const { sent, inner } = proxy([sse(fixture(1)), sse(fixture(2)), sse(fixture(3))])
        globalThis.fetch = inner
        const grok = grokLanguageModel(grokConnection(), 'grok-4.6', 'session-1')
        const cached = applyCaching('grok', { system: { stable: 'You are a terse assistant.', volatile: '' }, messages: [{ role: 'user', content: 'Weather in Paris and Lyon, added up.' }], sessionId: 'session-1', model: 'grok-4.6' })
        const result = streamText({
            model: wrapLanguageModel({ model: grok.model, middleware: grok.middleware }),
            system: cached.system,
            messages: cached.messages,
            tools: {
                get_weather: tool({ description: 'Weather for a city', inputSchema: z.object({ city: z.string() }), execute: async ({ city }) => ({ city, tempC: city === 'Paris' ? 11 : 14 }) }),
                add_numbers: tool({ description: 'Add two numbers', inputSchema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b }),
            },
            stopWhen: stepCountIs(6),
            providerOptions: mergeProviderOptions(mergeProviderOptions(cached.providerOptions, reasoningProviderOptions('grok', 'grok-4.6')), effortProviderOptions('grok', 'high')),
        })
        const steps = await result.steps

        expect(steps.map(step => step.toolCalls.map(call => call.toolName))).toEqual([['get_weather', 'get_weather'], ['add_numbers'], []])
        expect(await result.text).toMatch(/25/)
        expect(steps.every(step => step.reasoning.length > 0)).toBe(true)
        expect(sent).toHaveLength(3)
        for (const request of sent) {
            expect(request.url).toBe('https://cli-chat-proxy.grok.com/v1/responses')
            expect(request.body).toMatchObject({ model: 'grok-4.6', store: false, include: ['reasoning.encrypted_content'], prompt_cache_key: 'session-1', reasoning: { effort: 'high', summary: 'auto' } })
            expect(JSON.stringify(request.body)).not.toContain('item_reference')
        }
        const second = sent[1]!.body!.input as { type?: string; role?: string; encrypted_content?: string }[]
        expect(second.map(item => item.type ?? item.role)).toEqual(['developer', 'user', 'reasoning', 'function_call', 'function_call', 'function_call_output', 'function_call_output'])
        expect(second.find(item => item.type === 'reasoning')?.encrypted_content).toEqual(expect.any(String))
    })

    it('asks for its reasoning and never stores anything, even with no effort picked', async () => {
        const { sent, inner } = proxy([sse(fixture(3))])
        globalThis.fetch = inner
        const grok = grokLanguageModel(grokConnection(), 'grok-4.6', 'session-1')
        await streamText({ model: wrapLanguageModel({ model: grok.model, middleware: grok.middleware }), prompt: 'Hi' }).consumeStream()
        expect(sent[0]!.body).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] })
    })

    it('refuses to run without a Grok connection', () => {
        expect(() => grokLanguageModel(null, 'grok-4.6', 's')).toThrow('no Grok connection')
    })
})

describe('Grok in the rest of the engine', () => {
    it('behaves like OpenAI on the Responses API', () => {
        expect(behaviourOf('grok', 'grok-4.7')).toBe('openai')
        expect(effortProviderOptions('grok', 'low')).toEqual({ openai: { reasoningEffort: 'low', forceReasoning: true } })
    })

    it('sees images on every model but Grok 4.5, which hands vision to the first one switched on that can', () => {
        expect(modelSeesImages('grok', 'grok-4.7')).toBe(true)
        expect(modelSeesImages('grok', 'grok-4.5')).toBe(false)
        expect(grokVisionModel(grokConnection())).toBe('grok-4.6')
        expect(grokVisionModel({ ...grokConnection(), config: { ...grokConnection().config, models: ['grok-4.5'] } })).toBeNull()
    })
})
