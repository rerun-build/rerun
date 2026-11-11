import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-opencode-'))
// A developer routing their own SDK calls through a gateway has these set: OpenCode must not follow.
process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
process.env.OPENAI_BASE_URL = 'https://gateway.example.com/openai'

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { APICallError, generateText, streamText, tool } = await import('ai')
const { z } = await import('zod')
const { agentConfigSchema, connectionConfigSchema, OPENCODE_SNAPSHOT, OPENCODE_USAGE_URL } = await import('@rerun/contracts')
const { modelFor, resolveModel } = await import('./providers.js')
const { behaviourOf, modelSeesImages, opencodeFetch, opencodeVisionModel } = await import('./opencode.js')
const { findOpencodeUsage, opencodeCost } = await import('./opencode-stream.js')
const { recordPlanLimits, forgetPlanLimits } = await import('../connections/plan-limits.js')
const { classifyProviderError, RUN_ERROR_CODES } = await import('../runtime/provider-errors.js')
const { resetOpencodeCatalogForTests } = await import('../connections/opencode-catalog.js')

const FIXTURES = resolve(import.meta.dirname, '__fixtures__/opencode')
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), 'utf8')

function agentOn(model: string, keys: Record<string, string> | null = { OPENCODE_API_KEY: 'oc_sk_test' }, models: string[] = [model]) {
    const connection = keys ? { id: 'oc-cnx', config: connectionConfigSchema.parse({ name: 'OpenCode', provider: 'opencode', models, createdAt: '2026-11-04T00:00:00.000Z' }), env: keys } : null
    return {
        id: 'agent-oc',
        config: agentConfigSchema.parse({ name: 'p', provider: 'opencode', model }),
        soul: '',
        install: '',
        env: {},
        resolved: { connection, provider: 'opencode' as const, model },
    } as any
}

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function streamWith(body: string, status = 200) {
    fetchMock.mockImplementation(async () => new Response(body, { status, headers: { 'Content-Type': status === 200 ? 'text/event-stream' : 'application/json' } }))
}

function sent(call = 0): { url: string; init: RequestInit; headers: Headers; body: Record<string, any> } {
    const [url, init] = fetchMock.mock.calls[call] as [string | URL, RequestInit]
    return { url: String(url), init, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) }
}

async function run(model: Parameters<typeof streamText>[0]['model'], extra: Partial<Parameters<typeof streamText>[0]> = {}) {
    const result = streamText({ model, prompt: 'hello', maxRetries: 0, ...extra } as Parameters<typeof streamText>[0])
    const [text, reasoning, providerMetadata, usage] = await Promise.all([result.text, result.reasoningText, result.providerMetadata, result.usage])
    return { text, reasoning, providerMetadata, usage }
}

beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    resetOpencodeCatalogForTests()
})

afterEach(() => {
    globalThis.fetch = realFetch
    forgetPlanLimits('oc-cnx')
})

describe('resolveModel on OpenCode, one SDK per wire format', () => {
    it('speaks the chat format to the Go URL, reads the reasoning and records a Go call at no cost', async () => {
        streamWith(fixture('chat-go.sse'))
        const lookup = tool({ description: 'look up', inputSchema: z.object({ q: z.string() }), execute: async () => 'found' })
        const resolved = resolveModel(agentOn('go/deepseek-v4-pro'), undefined, { lookup }, [], { sessionId: 'session-42' })

        const result = await run(resolved.model, { tools: { lookup } })

        const request = sent()
        expect(request.url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions')
        expect(request.headers.get('authorization')).toBe('Bearer oc_sk_test')
        expect(request.headers.get('x-opencode-session')).toBe('session-42')
        expect(request.headers.get('user-agent')).toMatch(/^rerun-engine\//)
        expect(request.init.redirect).toBe('error')
        expect(request.body.model).toBe('deepseek-v4-pro')
        expect(request.body.reasoning).toBeUndefined()
        expect(result.reasoning).toBe('The user wants a lookup. I will call the tool.')
        expect(result.text).toBe('Let me check.')
        expect(result.providerMetadata?.opencode).toEqual({ billingSource: 'go', cost: 0 })
    })

    it('speaks the messages format with the Anthropic key header, a real output cap and the Console price', async () => {
        streamWith(fixture('messages-console.sse'))
        const resolved = resolveModel(agentOn('console/claude-haiku-5-5'), undefined, undefined, undefined, { sessionId: 'session-7' })

        const result = await run(resolved.model)

        const request = sent()
        expect(request.url).toBe('https://opencode.ai/inference/anthropic/v1/messages')
        expect(request.headers.get('x-api-key')).toBe('oc_sk_test')
        expect(request.headers.get('x-opencode-session')).toBe('session-7')
        expect(request.body.model).toBe('claude-haiku-5-5')
        // The SDK would cap an id it does not know at 4096 tokens.
        expect(request.body.max_tokens).toBe(32_000)
        expect(result.text).toBe('Hello from Haiku.')
        expect(result.reasoning).toBe('A short answer will do.')
        expect(result.providerMetadata?.opencode).toEqual({ billingSource: 'balance', cost: 0.00042 })
        expect(result.usage.inputTokenDetails?.cacheWriteTokens).toBe(2560)
    })

    it('speaks the responses format without the server-side store', async () => {
        streamWith(fixture('responses-go.sse'))
        const result = await run(resolveModel(agentOn('go/gpt-6-luna'), undefined, undefined, undefined, { sessionId: 's' }).model)

        const request = sent()
        expect(request.url).toBe('https://opencode.ai/inference/go/openai/v1/responses')
        expect(request.headers.get('authorization')).toBe('Bearer oc_sk_test')
        expect(request.body.model).toBe('gpt-6-luna')
        expect(request.body.store).toBe(false)
        expect(result.text).toBe('Hello from Luna.')
        expect(result.providerMetadata?.opencode).toEqual({ billingSource: 'go', cost: 0 })
    })

    // Google puts the model id in the URL path: only the id without its plan may go there.
    it('speaks the Google format with the id in the path and the Google key header', async () => {
        streamWith(fixture('google-go.sse'))
        const result = await run(resolveModel(agentOn('go/gemini-4-argon'), undefined, undefined, undefined, { sessionId: 's' }).model)

        const request = sent()
        expect(request.url).toBe('https://opencode.ai/inference/go/google/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse')
        expect(request.headers.get('x-goog-api-key')).toBe('oc_sk_test')
        expect(request.headers.get('x-opencode-session')).toBe('s')
        expect(result.text).toBe('Hello from Argon.')
        expect(result.providerMetadata?.opencode).toEqual({ billingSource: 'go', cost: 0 })
    })

    it('fails plainly on a connection without a key, and on a model OpenCode does not list', () => {
        expect(() => resolveModel(agentOn('go/deepseek-v4-pro', null))).toThrow('This OpenCode connection has no key')
        expect(() => resolveModel(agentOn('go/not-a-model'))).toThrow('OpenCode does not offer go/not-a-model')
    })
})

describe('modelFor on OpenCode', () => {
    const COMPLETION = { id: 'c', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'summary' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }

    // OpenCode refuses any request without a session: a one-shot call names one of its own.
    it('never sends a request without a session', async () => {
        fetchMock.mockImplementation(async () => Response.json(COMPLETION))
        await generateText({ model: modelFor(agentOn('go/glm-5.3')), prompt: 'summarise' })
        await generateText({ model: modelFor(agentOn('go/glm-5.3'), undefined, undefined, undefined, { sessionId: 'run-session' }), prompt: 'summarise' })
        expect(sent(0).headers.get('x-opencode-session')).toBe('agent-oc:one-shot')
        expect(sent(1).headers.get('x-opencode-session')).toBe('run-session')
        expect(sent(0).url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions')
    })
})

describe('opencodeFetch', () => {
    const go = OPENCODE_SNAPSHOT.find(model => model.id === 'go/deepseek-v4-pro')!
    const consoleClaude = OPENCODE_SNAPSHOT.find(model => model.id === 'console/claude-sonnet-5-5')!
    const connection = agentOn('go/deepseek-v4-pro').resolved.connection
    const refusal = (status: number, message: string) => vi.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'Error', message } }), { status, headers: { 'Content-Type': 'application/json', 'Content-Length': '99' } }))
    const messageOf = async (response: Response) => ((await response.json()) as { error: { message: string } }).error.message

    it('keeps headers set by the SDK and adds its own', async () => {
        const inner = vi.fn(async () => new Response('{}'))
        await opencodeFetch({ sessionId: 's1', connection, model: go }, inner as unknown as typeof fetch)('https://opencode.ai/x', { headers: { 'x-api-key': 'k' } })
        const init = (inner.mock.calls[0] as unknown as [string, RequestInit])[1]
        const headers = new Headers(init.headers)
        expect(headers.get('x-api-key')).toBe('k')
        expect(headers.get('x-opencode-session')).toBe('s1')
        expect(init.redirect).toBe('error')
    })

    it('names the Console credits on a 402, whatever model was asked', async () => {
        const response = await opencodeFetch({ sessionId: 's', connection, model: consoleClaude }, refusal(402, 'Insufficient account funds') as unknown as typeof fetch)('https://opencode.ai/x')
        expect(response.status).toBe(402)
        expect(await messageOf(response)).toBe('OpenCode Console credits used up: Insufficient account funds')
    })

    it('names the key on a 401, and a retired model on a 400', async () => {
        expect(await messageOf(await opencodeFetch({ sessionId: 's', connection, model: go }, refusal(401, 'Invalid credential') as unknown as typeof fetch)('u'))).toBe('OpenCode key refused (401): Invalid credential')
        expect(await messageOf(await opencodeFetch({ sessionId: 's', connection, model: go }, refusal(400, 'Model is unavailable') as unknown as typeof fetch)('u'))).toContain('Provider returned error: OpenCode no longer offers DeepSeek V4 Pro')
    })

    it('passes any other refusal through as it came, even one that is not JSON', async () => {
        const plain = vi.fn(async () => new Response('Bad gateway', { status: 502 }))
        const response = await opencodeFetch({ sessionId: 's', connection, model: go }, plain as unknown as typeof fetch)('u')
        expect(response.status).toBe(502)
        expect(await response.text()).toBe('Bad gateway')
        const unknown = await opencodeFetch({ sessionId: 's', connection, model: consoleClaude }, refusal(429, 'Slow down') as unknown as typeof fetch)('u')
        expect(await messageOf(unknown)).toBe('Slow down')
    })

    it('reads a 429 on Go as the plan limit when the usage read taken on the spot says a window is spent', async () => {
        fetchMock.mockImplementation(async () => Response.json({ usage: { weekly: { status: 'limited', percent: 97, resetsAt: '2026-11-06T15:00:00.000Z' } } }))
        const rateLimited = refusal(429, 'Too many requests')
        const spent = await opencodeFetch({ sessionId: 's', connection, model: go }, rateLimited as unknown as typeof fetch)('u')
        expect(await messageOf(spent)).toBe('OpenCode Go limit reached: weekly window · resets Nov 6, 3:00 PM UTC')
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(OPENCODE_USAGE_URL)
    })

    it('leaves a 429 on Go alone when the usage read fails, until a reading says a window is spent', async () => {
        fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
        const rateLimited = refusal(429, 'Too many requests')
        const untouched = await opencodeFetch({ sessionId: 's', connection, model: go }, rateLimited as unknown as typeof fetch)('u')
        expect(await messageOf(untouched)).toBe('Too many requests')

        recordPlanLimits('oc-cnx', [{ kind: 'weekly', label: null, usedPercent: 100, resetsAt: '2026-11-06T15:00:00.000Z' }])
        const spent = await opencodeFetch({ sessionId: 's', connection, model: go }, rateLimited as unknown as typeof fetch)('u')
        expect(await messageOf(spent)).toBe('OpenCode Go limit reached: weekly window · resets Nov 6, 3:00 PM UTC')
    })
})

describe('what a refused OpenCode run is classified as', () => {
    const error = (statusCode: number, message: string) => new APICallError({ message, url: 'u', requestBodyValues: {}, statusCode, isRetryable: statusCode === 429 })

    it('spends the plan or the credits, refuses the key, or refuses the model', () => {
        expect(classifyProviderError('opencode', error(402, 'OpenCode Console credits used up: Insufficient account funds'))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('opencode', error(429, 'OpenCode Go limit reached: 5-hour window'))).toBe(RUN_ERROR_CODES.usageLimit)
        expect(classifyProviderError('opencode', error(429, 'Too many requests'))).toBe(RUN_ERROR_CODES.overloaded)
        expect(classifyProviderError('opencode', error(401, 'OpenCode key refused (401): Invalid credential'))).toBe(RUN_ERROR_CODES.unauthorized)
        expect(classifyProviderError('opencode', error(400, 'Provider returned error: OpenCode no longer offers GLM-5'))).toBe(RUN_ERROR_CODES.refused)
        expect(classifyProviderError('opencode', new TypeError('fetch failed'))).toBeNull()
    })
})

describe('the usage OpenCode reports', () => {
    it('is found wherever the format nests it', () => {
        const usage = { billing_source: 'go', list_cost: 1 }
        expect(findOpencodeUsage({ usage: { opencode: usage } })).toBe(usage)
        expect(findOpencodeUsage({ response: { usage: { opencode: usage } } })).toBe(usage)
        expect(findOpencodeUsage({ candidates: [], usageMetadata: { opencode: usage } })).toBe(usage)
        expect(findOpencodeUsage({ choices: [{ delta: { content: 'x' } }] })).toBeUndefined()
    })

    it('costs nothing on Go and its list price on Console', () => {
        expect(opencodeCost({ billing_source: 'go', list_cost: 3.03e-5 })).toEqual({ billingSource: 'go', cost: 0 })
        expect(opencodeCost({ billing_source: 'balance', list_cost: 0.5 })).toEqual({ billingSource: 'balance', cost: 0.5 })
        expect(opencodeCost({ billing_source: 'balance' })).toBeUndefined()
        expect(opencodeCost({})).toBeUndefined()
    })
})

describe('how an OpenCode model behaves', () => {
    it('like the provider of its wire format', () => {
        expect(behaviourOf('opencode', 'go/claude-haiku-5-5')).toBe('anthropic')
        expect(behaviourOf('opencode', 'go/gpt-6-luna')).toBe('openai')
        expect(behaviourOf('opencode', 'go/deepseek-v4-pro')).toBe('openrouter')
        expect(behaviourOf('opencode', 'go/gemini-4-argon')).toBe('google')
        expect(behaviourOf('anthropic', 'go/gemini-4-argon')).toBe('anthropic')
    })

    it('sees images only when OpenCode says so', () => {
        expect(modelSeesImages('opencode', 'go/deepseek-v4-pro')).toBe(false)
        expect(modelSeesImages('opencode', 'go/kimi-k3.1-pro')).toBe(true)
        expect(modelSeesImages('openrouter', 'deepseek/deepseek-v4-pro')).toBe(true)
    })

    it('sees images on a custom endpoint only when its owner says the model does', () => {
        const custom = (vision?: boolean) => ({ id: 'c', config: { name: 'c', provider: 'custom', models: [], extraModels: [], baseUrl: 'http://localhost:11434/v1', vision, createdAt: '' }, env: {} }) as any
        expect(modelSeesImages('custom', 'llama3.2:3b', custom())).toBe(false)
        expect(modelSeesImages('custom', 'llama3.2-vision', custom(true))).toBe(true)
        expect(modelSeesImages('custom', 'any')).toBe(false)
    })

    it('hands vision to the cheapest Go model of the connection that sees', () => {
        const agent = agentOn('go/deepseek-v4-pro', undefined, ['go/deepseek-v4-pro', 'go/kimi-k3.1-pro', 'go/claude-haiku-5-5', 'console/gpt-6-luna'])
        expect(opencodeVisionModel(agent.resolved.connection)).toBe('go/claude-haiku-5-5')
        expect(opencodeVisionModel(agentOn('go/deepseek-v4-pro', undefined, ['go/deepseek-v4-pro', 'go/glm-5.3']).resolved.connection)).toBeNull()
        expect(opencodeVisionModel(null)).toBeNull()
    })

    // A free Go model can train on what it is sent: switched on, it still never takes the images of
    // a run that picked another model.
    it('never hands vision to a free Go model, even the only one that sees', () => {
        const connectionOn = (models: string[]) => agentOn('go/deepseek-v4-pro', undefined, models).resolved.connection
        expect(opencodeVisionModel(connectionOn(['go/deepseek-v4-pro', 'go/longcat-2.5-free']))).toBeNull()
        expect(opencodeVisionModel(connectionOn(['go/deepseek-v4-pro', 'go/longcat-2.5-free', 'go/claude-haiku-5-5']))).toBe('go/claude-haiku-5-5')
    })
})
