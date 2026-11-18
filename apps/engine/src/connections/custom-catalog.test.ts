import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_DEFAULT_CONTEXT_WINDOW, connectionConfigSchema } from '@rerun/contracts'
import { candidateBaseUrls, customContextWindow, customDiscoveredModels, parseModelList, probeCustomEndpoint, refreshCustomCatalog, resetCustomCatalogForTests } from './custom-catalog.js'
import { isConnected, toSummary } from './loader.js'
import { effectiveCompactAt, runContextWindow } from '../runtime/compaction/compact.js'

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void

let server: Server
let baseUrl: string
let handler: Handler
const seen: { method: string; url: string; authorization: string | undefined; body: string }[] = []

function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
}

beforeEach(async () => {
    resetCustomCatalogForTests()
    seen.length = 0
    server = createServer((req, res) => {
        let body = ''
        req.on('data', chunk => (body += chunk))
        req.on('end', () => {
            seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, body })
            handler(req, body, res)
        })
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterEach(async () => {
    await new Promise<void>(done => server.close(() => done()))
})

function connection(extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    return { id: 'cnx-custom', config: connectionConfigSchema.parse({ name: 'Ollama', provider: 'custom', baseUrl, createdAt: '2026-11-05T00:00:00.000Z', ...extra }), env }
}

describe('parseModelList', () => {
    it('reads the OpenAI shape, the bare array, and the window under each server family name', () => {
        expect(parseModelList({ data: [{ id: 'llama3.3:70b' }, { id: 'qwen', context_length: 32_768 }, { id: 'vllm-model', max_model_len: 65_536 }] })).toEqual([
            { id: 'llama3.3:70b', contextWindow: null },
            { id: 'qwen', contextWindow: 32_768 },
            { id: 'vllm-model', contextWindow: 65_536 },
        ])
        expect(parseModelList([{ id: 'a' }])).toEqual([{ id: 'a', contextWindow: null }])
    })

    it('drops rows without an id, duplicates and nonsense windows', () => {
        expect(parseModelList({ data: [{ id: 'a' }, { id: 'a' }, { name: 'no-id' }, { id: 'b', context_length: -1 }, null] })).toEqual([
            { id: 'a', contextWindow: null },
            { id: 'b', contextWindow: null },
        ])
        expect(parseModelList('garbage')).toEqual([])
    })
})

describe('candidateBaseUrls', () => {
    it("also tries the Docker host for a loopback address, which is the container's own inside one", () => {
        expect(candidateBaseUrls('http://localhost:11434/v1/')).toEqual(['http://localhost:11434/v1', 'http://host.docker.internal:11434/v1'])
        expect(candidateBaseUrls('http://127.0.0.1:1234/v1')).toEqual(['http://127.0.0.1:1234/v1', 'http://host.docker.internal:1234/v1'])
        expect(candidateBaseUrls('https://api.groq.com/openai/v1')).toEqual(['https://api.groq.com/openai/v1'])
    })
})

describe('probeCustomEndpoint', () => {
    it('lists the models with the key it was given', async () => {
        handler = (_req, _body, res) => json(res, 200, { object: 'list', data: [{ id: 'qwen3:4b' }, { id: 'llama3.2:3b' }] })

        const result = await probeCustomEndpoint({ baseUrl: `${baseUrl}/`, apiKey: 'k-1' })

        expect(result).toEqual({ baseUrl, models: [{ id: 'qwen3:4b', contextWindow: null }, { id: 'llama3.2:3b', contextWindow: null }], problem: null, detail: null })
        expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/models', authorization: 'Bearer k-1' })
    })

    it('sends no Authorization header without a key', async () => {
        handler = (_req, _body, res) => json(res, 200, { data: [{ id: 'm' }] })
        await probeCustomEndpoint({ baseUrl })
        expect(seen[0]?.authorization).toBeUndefined()
    })

    it('says the key was turned away rather than calling the server unreachable', async () => {
        handler = (_req, _body, res) => json(res, 401, { error: { message: 'Invalid API key' } })
        const result = await probeCustomEndpoint({ baseUrl, apiKey: 'wrong' })
        expect(result.problem).toBe('unauthorized')
        expect(result.detail).toContain('Invalid API key')
    })

    it('reports a server that lists nothing, so the form can ask for a model id', async () => {
        handler = (_req, _body, res) => json(res, 404, { error: 'not found' })
        expect((await probeCustomEndpoint({ baseUrl })).problem).toBe('not_listed')
    })

    it('tries one token of a typed model when the server does not list its models', async () => {
        handler = (req, _body, res) => (req.url === '/v1/models' ? json(res, 404, {}) : json(res, 200, { choices: [{ message: { content: 'ok' } }] }))

        const result = await probeCustomEndpoint({ baseUrl, model: 'my-finetune' })

        expect(result).toMatchObject({ problem: null, models: [{ id: 'my-finetune', contextWindow: null }] })
        const chat = seen.find(request => request.url === '/v1/chat/completions')
        expect(JSON.parse(chat!.body)).toMatchObject({ model: 'my-finetune', max_tokens: 1 })
    })

    it('reports a typed model the server refuses', async () => {
        handler = (req, _body, res) => (req.url === '/v1/models' ? json(res, 200, { data: [{ id: 'a' }] }) : json(res, 404, { error: { message: 'model "nope" not found' } }))
        const result = await probeCustomEndpoint({ baseUrl, model: 'nope' })
        expect(result.problem).toBe('model_refused')
        expect(result.detail).toContain('not found')
    })

    it('calls a closed port unreachable and names why', async () => {
        await new Promise<void>(done => server.close(() => done()))
        const realFetch = globalThis.fetch
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
            new URL(String(input)).hostname === 'host.docker.internal'
                ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))
                : realFetch(input, init))
        const result = await probeCustomEndpoint({ baseUrl })
        fetchSpy.mockRestore()
        expect(result).toMatchObject({ baseUrl, models: [], problem: 'unreachable', detail: 'ECONNREFUSED' })
        server = createServer()
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    })
})

describe('the live reading of a connection', () => {
    it('is what the summary lists and what compaction budgets against', async () => {
        handler = (_req, _body, res) => json(res, 200, { data: [{ id: 'listed', context_length: 40_000 }, { id: 'silent' }] })
        const cnx = connection({ models: ['listed'], contextWindow: 64_000 })

        expect(toSummary(cnx).discoveredModels).toBeNull()
        await refreshCustomCatalog(cnx)

        expect(customDiscoveredModels(cnx.id)).toEqual([
            { id: 'listed', contextWindow: 40_000 },
            { id: 'silent', contextWindow: null },
        ])
        expect(toSummary(cnx).discoveredModels).toHaveLength(2)
        expect(runContextWindow('listed', 'custom', cnx)).toBe(40_000)
        expect(runContextWindow('silent', 'custom', cnx)).toBe(64_000)
    })

    it('sets the compaction point from the context_length the endpoint lists for the model', async () => {
        handler = (_req, _body, res) => json(res, 200, { data: [{ id: 'big', context_length: 262_144 }] })
        const cnx = connection({ models: ['big'], contextWindow: 1_000_000 })
        await refreshCustomCatalog(cnx)
        expect(runContextWindow('big', 'custom', cnx)).toBe(262_144)
        expect(effectiveCompactAt('small', 'custom', 'big', cnx)).toBe(196_608)
        expect(effectiveCompactAt('large', 'custom', 'big', cnx)).toBe(196_608)
    })

    it('keeps its last reading when the endpoint stops answering', async () => {
        handler = (_req, _body, res) => json(res, 200, { data: [{ id: 'm' }] })
        const cnx = connection()
        await refreshCustomCatalog(cnx)
        handler = (_req, _body, res) => json(res, 500, {})
        await refreshCustomCatalog(cnx)
        expect(customDiscoveredModels(cnx.id)).toEqual([{ id: 'm', contextWindow: null }])
    })

    it('falls back on a default window, so compaction always has a threshold', () => {
        expect(customContextWindow(connection(), 'anything')).toBe(CUSTOM_DEFAULT_CONTEXT_WINDOW)
        expect(customContextWindow(null, 'anything')).toBe(CUSTOM_DEFAULT_CONTEXT_WINDOW)
    })
})

describe('isConnected', () => {
    it('counts a custom endpoint by its address, key or not', () => {
        expect(isConnected(connection())).toBe(true)
        expect(isConnected(connection({}, { CUSTOM_API_KEY: 'k' }))).toBe(true)
        expect(isConnected(connection({ baseUrl: '' }))).toBe(false)
    })
})
