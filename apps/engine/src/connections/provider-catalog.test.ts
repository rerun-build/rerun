import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionConfigSchema, type Provider } from '@moldwright/contracts'
import { forgetProviderCatalog, providerDiscoveredModels, refreshProviderCatalog, refreshStaleProviderCatalogs, resetProviderCatalogForTests } from './provider-catalog.js'
import { toSummary } from './loader.js'
import { servesModel } from './resolve.js'
import { allowedModel } from './plan.js'
import { runContextWindow } from '../runtime/compaction/compact.js'

const fixture = (name: string): string => readFileSync(resolve(import.meta.dirname, '__fixtures__/provider-models', `${name}.json`), 'utf8')

type Seen = { url: string; headers: Record<string, string> }
const seen: Seen[] = []
let answer: (url: URL) => Response

function connection(provider: Provider, env: Record<string, string>, extra: Record<string, unknown> = {}) {
    return { id: `cnx-${provider}`, config: connectionConfigSchema.parse({ name: provider, provider, createdAt: '2026-11-20T00:00:00.000Z', ...extra }), env }
}

const ok = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
    resetProviderCatalogForTests()
    seen.length = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input))
        seen.push({ url: url.toString(), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
        return answer(url)
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function hanging(signal: AbortSignal | null | undefined): Promise<Response> {
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))
}

describe('the live model list of a key connection', () => {
    it('reads OpenRouter from the connection base URL and lists it in the summary', async () => {
        answer = () => ok(fixture('openrouter'))
        const cnx = connection('openrouter', { OPENROUTER_API_KEY: 'sk-or-secret' }, { baseUrl: 'https://router.example/api/v1/' })
        expect(toSummary(cnx).discoveredModels).toBeNull()

        await refreshProviderCatalog(cnx)

        expect(seen[0].url).toBe('https://router.example/api/v1/models')
        expect(seen[0].headers.authorization).toBe('Bearer sk-or-secret')
        const listed = toSummary(cnx).discoveredModels
        expect(listed?.map(model => model.id)).toEqual(['google/gemini-4-carbon', 'anthropic/claude-opus-5.5', 'openrouter/auto'])
        expect(listed?.[0]).toMatchObject({ label: 'Google: Gemini 4 Carbon', contextWindow: 2_000_000, price: { input: 2.5, output: 15 } })
        expect(JSON.stringify(toSummary(cnx))).not.toContain('sk-or-secret')
    })

    it('reads OpenAI with the key', async () => {
        answer = () => ok(fixture('openai'))
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-openai' })
        await refreshProviderCatalog(cnx)
        expect(seen[0].url).toBe('https://api.openai.com/v1/models')
        expect(seen[0].headers.authorization).toBe('Bearer sk-openai')
        expect(providerDiscoveredModels(cnx.id)?.map(model => model.id)).toEqual(['gpt-6-sol', 'gpt-7-preview'])
    })

    it('reads every Google page with the key in a header, never in the address', async () => {
        answer = url => ok(fixture(url.searchParams.get('pageToken') === 'page-2' ? 'google-page2' : 'google-page1'))
        const cnx = connection('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-secret' })
        await refreshProviderCatalog(cnx)
        expect(seen).toHaveLength(2)
        expect(seen.every(call => call.headers['x-goog-api-key'] === 'AIza-secret' && !call.url.includes('AIza-secret'))).toBe(true)
        expect(seen[1].url).toContain('pageToken=page-2')
        expect(providerDiscoveredModels(cnx.id)?.map(model => model.id)).toEqual(['gemini-4-argon', 'gemini-4-carbon'])
        expect(runContextWindow('gemini-4-carbon', 'google', cnx)).toBe(2_097_152)
    })

    it('reads every Anthropic page with its version header', async () => {
        answer = url => ok(fixture(url.searchParams.get('after_id') ? 'anthropic-page2' : 'anthropic-page1'))
        const cnx = connection('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-api' })
        await refreshProviderCatalog(cnx)
        expect(seen[0].headers['x-api-key']).toBe('sk-ant-api')
        expect(seen[0].headers['anthropic-version']).toBe('2023-06-01')
        expect(seen[1].url).toContain('after_id=claude-sonnet-5-5')
        expect(providerDiscoveredModels(cnx.id)?.map(model => model.id)).toEqual(['claude-opus-6', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
        expect(runContextWindow('claude-opus-6', 'anthropic', cnx)).toBe(1_000_000)
    })

    it('keeps the last good list when a later read fails, and leaves the fallback when none succeeded', async () => {
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-openai' })
        answer = () => new Response('{}', { status: 500 })
        await refreshProviderCatalog(cnx)
        expect(toSummary(cnx).discoveredModels).toBeNull()

        answer = () => ok(fixture('openai'))
        await refreshProviderCatalog(cnx)
        answer = () => {
            throw new TypeError('fetch failed')
        }
        await refreshProviderCatalog(cnx)
        expect(toSummary(cnx).discoveredModels).toHaveLength(2)

        answer = () => ok('{"data":[]}')
        await refreshProviderCatalog(cnx)
        expect(toSummary(cnx).discoveredModels).toHaveLength(2)
    })

    it('refuses an answer larger than the size cap', async () => {
        answer = () => ok(JSON.stringify({ data: [{ id: 'x'.repeat(9 * 1024 * 1024) }] }))
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-openai' })
        await refreshProviderCatalog(cnx)
        expect(providerDiscoveredModels(cnx.id)).toBeNull()
    })

    it('does not read without a key and leaves other providers alone', async () => {
        answer = () => ok(fixture('openai'))
        await refreshProviderCatalog(connection('openai', {}))
        await refreshProviderCatalog(connection('claude', { CLAUDE_CODE_OAUTH_TOKEN: 't' }))
        expect(seen).toHaveLength(0)
    })

    it('rereads a good list once 30 minutes have passed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        answer = () => ok(fixture('openai'))
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-openai' })
        await refreshProviderCatalog(cnx)
        vi.setSystemTime(Date.now() + 29 * 60_000)
        refreshStaleProviderCatalogs([cnx])
        expect(seen).toHaveLength(1)
        vi.setSystemTime(Date.now() + 2 * 60_000)
        refreshStaleProviderCatalogs([cnx])
        expect(seen).toHaveLength(2)
    })

    it('retries a failed read after 2 minutes', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        answer = () => new Response('{}', { status: 503 })
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-openai' })
        await refreshProviderCatalog(cnx)
        vi.setSystemTime(Date.now() + 60_000)
        refreshStaleProviderCatalogs([cnx])
        expect(seen).toHaveLength(1)
        vi.setSystemTime(Date.now() + 61_000)
        refreshStaleProviderCatalogs([cnx])
        expect(seen).toHaveLength(2)
    })

    it('drops the answer of a read that was running when the connection was forgotten, and reads afresh', async () => {
        let finish: (response: Response) => void = () => {}
        vi.mocked(globalThis.fetch).mockImplementationOnce(async (input, init) => {
            seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
            return new Promise<Response>(resolve => (finish = resolve))
        })
        const cnx = connection('openai', { OPENAI_API_KEY: 'sk-old' })
        const slow = refreshProviderCatalog(cnx)
        await vi.waitFor(() => expect(seen).toHaveLength(1))
        forgetProviderCatalog(cnx.id)
        finish(ok(fixture('openai')))
        await slow
        expect(providerDiscoveredModels(cnx.id)).toBeNull()

        answer = () => ok(JSON.stringify({ data: [{ id: 'gpt-fresh' }] }))
        await refreshProviderCatalog({ ...cnx, env: { OPENAI_API_KEY: 'sk-new' } })
        expect(seen[1].headers.authorization).toBe('Bearer sk-new')
        expect(providerDiscoveredModels(cnx.id)?.map(model => model.id)).toEqual(['gpt-fresh'])
    })

    it('gives up on a listing that hangs once its single deadline passes', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        vi.mocked(globalThis.fetch).mockImplementation(async (_input, init) => hanging(init?.signal))
        const cnx = connection('anthropic', { ANTHROPIC_API_KEY: 'sk-ant' })
        let settled = false
        const attempt = refreshProviderCatalog(cnx).then(() => (settled = true))
        await vi.advanceTimersByTimeAsync(14_999)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 })
        await attempt
        expect(providerDiscoveredModels(cnx.id)).toBeNull()
    })

    it('shares that deadline across pages', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let calls = 0
        vi.mocked(globalThis.fetch).mockImplementation(async (_input, init) => {
            calls += 1
            if (calls === 1) {
                await new Promise(resolve => setTimeout(resolve, 10_000))
                return ok(fixture('anthropic-page1'))
            }
            return hanging(init?.signal)
        })
        const cnx = connection('anthropic', { ANTHROPIC_API_KEY: 'sk-ant' })
        let settled = false
        const attempt = refreshProviderCatalog(cnx).then(() => (settled = true))
        await vi.advanceTimersByTimeAsync(15_000)
        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 })
        await attempt
        expect(calls).toBe(2)
        expect(providerDiscoveredModels(cnx.id)).toBeNull()
    })

    it('keeps at most 2000 models and each id once across pages', async () => {
        const page = (from: number, more: boolean) => ok(JSON.stringify({ data: Array.from({ length: 1500 }, (_, i) => ({ id: `m-${from + i}` })), has_more: more, last_id: `m-${from + 1499}` }))
        answer = url => (url.searchParams.get('after_id') ? page(1000, false) : page(0, true))
        const cnx = connection('anthropic', { ANTHROPIC_API_KEY: 'sk-ant' })
        await refreshProviderCatalog(cnx)
        const ids = providerDiscoveredModels(cnx.id)?.map(model => model.id) ?? []
        expect(ids).toHaveLength(2000)
        expect(new Set(ids).size).toBe(2000)
    })
})

describe('a model only the live OpenRouter list has', () => {
    it('can be turned on and is then served as is', async () => {
        answer = () => ok(fixture('openrouter'))
        const cnx = connection('openrouter', { OPENROUTER_API_KEY: 'sk-or' }, { models: ['anthropic/claude-sonnet-5.5'] })
        await refreshProviderCatalog(cnx)
        expect(servesModel(cnx, 'google/gemini-4-carbon')).toBe(false)

        const enabled = { ...cnx, config: connectionConfigSchema.parse({ ...cnx.config, models: [...cnx.config.models, 'google/gemini-4-carbon'] }) }
        expect(servesModel(enabled, 'google/gemini-4-carbon')).toBe(true)
        expect(allowedModel('openrouter', 'google/gemini-4-carbon')).toBe('google/gemini-4-carbon')
        expect(runContextWindow('google/gemini-4-carbon', 'openrouter', enabled)).toBe(2_000_000)
    })
})
