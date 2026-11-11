import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENCODE_SNAPSHOT, connectionConfigSchema, parseOpencodeCatalog } from '@rerun/contracts'
import { liveOpencodeProviderModels, opencodeModel, opencodeProviderModels, refreshOpencodeCatalog, refreshStaleOpencodeCatalog, resetOpencodeCatalogForTests } from './opencode-catalog.js'
import { planLimitWindowsFromOpencode, readPlanLimits, forgetPlanLimits } from './plan-limits.js'
import { refreshOpencodePlanLimits, refreshStaleOpencodePlanLimits, forgetOpencodePlanLimitsAttempt } from './opencode-plan-limits.js'
import { runContextWindow } from '../runtime/compaction/compact.js'

const FIXTURES = resolve(import.meta.dirname, '../agents/__fixtures__/opencode')
const goCatalog = JSON.parse(readFileSync(resolve(FIXTURES, 'go-models.json'), 'utf8')) as { data: Record<string, unknown>[] }
const consoleCatalog = JSON.parse(readFileSync(resolve(FIXTURES, 'console-models.json'), 'utf8')) as { data: Record<string, unknown>[] }

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    resetOpencodeCatalogForTests()
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('parseOpencodeCatalog', () => {
    // The snapshot is generated from these very fixtures: if the parser drifts, the two disagree.
    it('turns the recorded catalogs into the snapshot, byte for byte', () => {
        expect([...parseOpencodeCatalog(goCatalog, 'go'), ...parseOpencodeCatalog(consoleCatalog, 'console')]).toEqual(OPENCODE_SNAPSHOT)
    })

    // A Go subscription is served the free models; Console answers one with a 429 that tells the
    // caller to subscribe to Go, so they are worth listing on one side and not on the other.
    it('keeps the free models of Go, and drops those of Console', () => {
        const go = parseOpencodeCatalog(goCatalog, 'go')
        expect(go).toHaveLength(30)
        expect(go.map(model => model.id)).toContain('go/beam-free')
        expect(go.find(model => model.id === 'go/longcat-2.5-free')).toMatchObject({ price: { input: 0, output: 0 }, images: true })
        const consoleModels = parseOpencodeCatalog(consoleCatalog, 'console')
        expect(consoleModels.some(model => /-free$|big-pickle/.test(model.id))).toBe(false)
    })

    it('prefixes each id with its plan, so a model sold on both sides is two picks', () => {
        const ids = OPENCODE_SNAPSHOT.map(model => model.id)
        expect(ids).toContain('go/deepseek-v4-pro')
        expect(ids).toContain('console/deepseek-v4-pro')
        expect(new Set(ids).size).toBe(ids.length)
        expect(OPENCODE_SNAPSHOT.find(model => model.id === 'go/deepseek-v4-pro')).toMatchObject({ upstreamId: 'deepseek-v4-pro', plan: 'go', wire: 'chat', images: false })
    })

    it('reads the input limit before the context window', () => {
        expect(OPENCODE_SNAPSHOT.find(model => model.id === 'go/gpt-6-luna')?.contextWindow).toBe(922_000)
        expect(OPENCODE_SNAPSHOT.find(model => model.id === 'go/glm-5.3')?.contextWindow).toBe(1_000_000)
    })

    it('drops a model without tools, on an unknown format, or pointing away from opencode.ai', () => {
        const [first] = goCatalog.data as { api: Record<string, { base_url: string }>; capabilities: Record<string, unknown> }[]
        const variant = (patch: Record<string, unknown>) => ({ data: [{ ...first, ...patch }] })
        expect(parseOpencodeCatalog(variant({}), 'go')).toHaveLength(1)
        expect(parseOpencodeCatalog(variant({ capabilities: { ...first.capabilities, tools: { supported: false } } }), 'go')).toEqual([])
        expect(parseOpencodeCatalog(variant({ api: { 'speech-to-text': { base_url: 'https://opencode.ai/x' } } }), 'go')).toEqual([])
        expect(parseOpencodeCatalog(variant({ api: { 'chat-completions': { base_url: 'https://evil.example.com/v1' } } }), 'go')).toEqual([])
    })

    it('skips an entry it cannot read rather than the whole catalog', () => {
        expect(parseOpencodeCatalog({ data: [{ id: 'broken' }, ...goCatalog.data] }, 'go')).toHaveLength(30)
        expect(parseOpencodeCatalog(null, 'go')).toEqual([])
        expect(parseOpencodeCatalog({ data: 'nope' }, 'go')).toEqual([])
    })
})

describe('the live catalog', () => {
    const answer = (go: unknown, consoleBody: unknown) =>
        fetchMock.mockImplementation(async (url: string) => (url.includes('/go/') ? Response.json(go) : Response.json(consoleBody)))

    it('falls back on the snapshot until a reading lands', () => {
        expect(opencodeModel('go/deepseek-v4-pro')?.label).toBe('DeepSeek V4 Pro')
        expect(opencodeProviderModels()).toHaveLength(OPENCODE_SNAPSHOT.length)
        expect(liveOpencodeProviderModels()).toBeNull()
    })

    it('knows a model published after the snapshot, and its window', async () => {
        const fresh = { ...goCatalog.data[1], id: 'brand-new-model', name: 'Brand New', limit: { context: 640_000, output: 64_000 } }
        answer({ data: [...goCatalog.data, fresh] }, consoleCatalog)
        await refreshOpencodeCatalog()
        expect(opencodeModel('go/brand-new-model')?.label).toBe('Brand New')
        expect(runContextWindow('go/brand-new-model', 'opencode')).toBe(640_000)
        expect(liveOpencodeProviderModels()?.some(model => model.id === 'go/brand-new-model')).toBe(true)
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    })

    it('keeps its last reading when a read fails, and is not asked again before half an hour', async () => {
        answer(goCatalog, consoleCatalog)
        await refreshOpencodeCatalog()
        fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))
        await refreshOpencodeCatalog()
        expect(liveOpencodeProviderModels()).toHaveLength(OPENCODE_SNAPSHOT.length)
        const calls = fetchMock.mock.calls.length
        refreshStaleOpencodeCatalog()
        expect(fetchMock.mock.calls.length).toBe(calls)
    })

    it('reads again once its last attempt is half an hour old, and knows only its two plans', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            answer(goCatalog, consoleCatalog)
            await refreshOpencodeCatalog()
            vi.setSystemTime(Date.now() + 31 * 60_000)
            refreshStaleOpencodeCatalog()
            expect(fetchMock).toHaveBeenCalledTimes(4)
        } finally {
            vi.useRealTimers()
        }
        expect(opencodeModel('deepseek-v4-pro')).toBeUndefined()
    })

    it('survives a catalog that never answers', async () => {
        fetchMock.mockImplementation(async () => {
            throw new DOMException('timed out', 'TimeoutError')
        })
        await expect(refreshOpencodeCatalog()).resolves.toBeUndefined()
        expect(opencodeModel('go/glm-5.3')).toBeDefined()
    })
})

describe('planLimitWindowsFromOpencode', () => {
    it('reads the three Go windows', () => {
        const body = {
            usage: {
                rolling: { status: 'ok', percent: 12, resetsAt: '2026-11-04T20:00:00Z' },
                weekly: { status: 'ok', percent: 40, resetsAt: '2026-11-09T00:00:00Z' },
                monthly: { status: 'ok', percent: 5, resetsAt: null },
            },
        }
        expect(planLimitWindowsFromOpencode(body)).toEqual([
            { kind: 'session', label: null, usedPercent: 12, resetsAt: '2026-11-04T20:00:00Z' },
            { kind: 'weekly', label: null, usedPercent: 40, resetsAt: '2026-11-09T00:00:00Z' },
            { kind: 'monthly', label: null, usedPercent: 5, resetsAt: null },
        ])
    })

    it('reads a window OpenCode says is spent as full', () => {
        expect(planLimitWindowsFromOpencode({ usage: { weekly: { status: 'limited', percent: 97 } } })).toEqual([{ kind: 'weekly', label: null, usedPercent: 100, resetsAt: null }])
    })

    it('never throws on a shape it does not know', () => {
        expect(planLimitWindowsFromOpencode(null)).toEqual([])
        expect(planLimitWindowsFromOpencode('not json')).toEqual([])
        expect(planLimitWindowsFromOpencode({ usage: { weekly: { percent: 'a lot' } } })).toEqual([])
        expect(planLimitWindowsFromOpencode({ usage: {} })).toEqual([])
    })
})

describe('refreshOpencodePlanLimits', () => {
    const connection = (id = 'oc-1', key: string | null = 'oc_sk_k') => ({
        id,
        config: connectionConfigSchema.parse({ name: 'OpenCode', provider: 'opencode', createdAt: '2026-11-04T00:00:00.000Z' }),
        env: key ? { OPENCODE_API_KEY: key } : {},
    })

    afterEach(() => {
        forgetPlanLimits('oc-1')
        forgetOpencodePlanLimitsAttempt('oc-1')
    })

    it('reads the account usage with the key and records the windows', async () => {
        fetchMock.mockImplementation(async () => Response.json({ usage: { rolling: { status: 'ok', percent: 30 } } }))
        await refreshOpencodePlanLimits(connection())
        expect(fetchMock.mock.calls[0][0]).toBe('https://opencode.ai/zen/go/v1/usage')
        expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('authorization')).toBe('Bearer oc_sk_k')
        expect(readPlanLimits('oc-1')?.windows).toEqual([{ kind: 'session', label: null, usedPercent: 30, resetsAt: null }])
    })

    it('asks once for two callers, and not at all without a key or for another provider', async () => {
        fetchMock.mockImplementation(async () => Response.json({ usage: {} }))
        await Promise.all([refreshOpencodePlanLimits(connection()), refreshOpencodePlanLimits(connection())])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await refreshOpencodePlanLimits(connection('oc-2', null))
        await refreshOpencodePlanLimits(null)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('survives a usage endpoint that is down or answers garbage', async () => {
        fetchMock.mockImplementation(async () => {
            throw new TypeError('fetch failed')
        })
        await expect(refreshOpencodePlanLimits(connection())).resolves.toBeUndefined()
        forgetOpencodePlanLimitsAttempt('oc-1')
        fetchMock.mockImplementation(async () => new Response('not json', { status: 200 }))
        await refreshOpencodePlanLimits(connection())
        expect(readPlanLimits('oc-1')).toBeNull()
    })

    it('reads a stale OpenCode connection in the background, and leaves the others alone', async () => {
        fetchMock.mockImplementation(async () => Response.json({ usage: {} }))
        const claude = { ...connection('cl-1'), config: connectionConfigSchema.parse({ name: 'Claude', provider: 'claude', createdAt: '2026-11-04T00:00:00.000Z' }) }
        refreshStaleOpencodePlanLimits([claude, connection()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('keeps no reading from a refusal, and paces the background reads', async () => {
        fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
        await refreshOpencodePlanLimits(connection())
        expect(readPlanLimits('oc-1')).toBeNull()
        refreshStaleOpencodePlanLimits([connection()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
