import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RERUN_MODEL, RERUN_MODELS } from '@rerun/contracts'
import { RERUN_UPSTREAM_MODELS } from '@/lib/engine/constants'
import { notifyBudgetExhausted } from '@/ee/services/budgetNotification.service'
import { getWorkspaceBudgetByEngineKey, recordRerunUsage } from '@/ee/services/rerunBudget.service'
import { POST } from './rerun-chat'

vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }))
vi.mock('@/ee/services/budgetNotification.service', () => ({ notifyBudgetExhausted: vi.fn() }))
vi.mock('@/ee/services/rerunBudget.service', () => ({
    ensureCurrentPeriod: vi.fn(async (b: unknown) => b),
    getWorkspaceBudgetByEngineKey: vi.fn(),
    hasRemainingBudget: vi.fn(() => true),
    recordRerunUsage: vi.fn(),
    RERUN_CREDIT_PAUSED_ERROR: 'rerun_credit_paused',
}))

const originalMaxKey = process.env.RERUN_MAX_API_KEY
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY

function request(model: string = RERUN_MODEL, extra: Record<string, unknown> = {}) {
    return new Request('https://hub.test/api/llm/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer engine-key', 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], ...extra }),
    })
}

describe('POST /api/llm/chat/completions', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(getWorkspaceBudgetByEngineKey).mockResolvedValue({ workspaceId: 1 } as Awaited<ReturnType<typeof getWorkspaceBudgetByEngineKey>>)
        process.env.OPENROUTER_API_KEY = 'internal-key'
        process.env.RERUN_MAX_API_KEY = 'max-key'
    })

    afterEach(() => {
        if (originalMaxKey === undefined) delete process.env.RERUN_MAX_API_KEY
        else process.env.RERUN_MAX_API_KEY = originalMaxKey
        if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
        else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
    })

    it('refuses with 402 and calls no model while the workspace credit is paused', async () => {
        vi.mocked(getWorkspaceBudgetByEngineKey).mockResolvedValue({ workspaceId: 1, paused: true } as Awaited<ReturnType<typeof getWorkspaceBudgetByEngineKey>>)
        const fetchMock = vi.spyOn(globalThis, 'fetch')

        const response = await POST(request())

        expect(response.status).toBe(402)
        expect(await response.json()).toEqual({ error: 'rerun_credit_paused' })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(notifyBudgetExhausted).not.toHaveBeenCalled()
    })

    it('spends the dedicated Rerun key, not the hub key', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [] }))

        await POST(request())

        const init = fetchMock.mock.calls[0]?.[1] as RequestInit
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer max-key')
    })

    // A fresh Response per call: the metering wrapper reads the body, and one shared instance can
    // only be read once.
    async function upstreamModelFor(model: string) {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [], usage: { cost: 0.001 } }))
        await (await POST(request(model))).text()
        const sent = JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string) as { model: string; messages: unknown[] }
        expect(sent.messages).toHaveLength(1)
        return sent.model
    }

    // The aliases are the whole contract with the boxes: they name a tier, the hub says what it runs.
    it('resolves each tier to its own model', async () => {
        expect(await upstreamModelFor(RERUN_MODELS.fast)).toBe(RERUN_UPSTREAM_MODELS.fast)
        expect(await upstreamModelFor(RERUN_MODELS.balanced)).toBe(RERUN_UPSTREAM_MODELS.balanced)
        expect(await upstreamModelFor(RERUN_MODELS.smart)).toBe(RERUN_UPSTREAM_MODELS.smart)
    })

    it('asks Fast for a low reasoning effort and leaves the other tiers as the box sent them', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [] }))
        const sentReasoning = async (model: string) => {
            await (await POST(request(model, { reasoning: { enabled: true } }))).text()
            return (JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string) as { reasoning: unknown }).reasoning
        }

        expect(await sentReasoning(RERUN_MODELS.fast)).toEqual({ effort: 'low' })
        expect(await sentReasoning(RERUN_MODELS.balanced)).toEqual({ enabled: true })
        expect(await sentReasoning(RERUN_MODELS.smart)).toEqual({ enabled: true })
    })

    // The box sends the system prompt in two blocks (stable, then what moves between turns) and does
    // not know what model a tier runs: the hub marks each block and the prefix up to the last message
    // for an hour, and only for an Anthropic model.
    it('asks an Anthropic model to cache each system block and the prefix, and leaves the others to cache on their own', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [] }))
        const messages = [
            { role: 'system', content: 'stable rules' },
            { role: 'system', content: 'today is Monday' },
            { role: 'user', content: 'hi' },
        ]
        const sentCaching = async (model: string) => {
            await (await POST(request(model, { messages }))).text()
            return JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string) as Record<string, unknown>
        }
        const hour = { type: 'ephemeral', ttl: '1h' }

        for (const tier of ['fast', 'balanced', 'smart'] as const) {
            const sent = await sentCaching(RERUN_MODELS[tier])
            if (RERUN_UPSTREAM_MODELS[tier].startsWith('anthropic/')) {
                expect(sent.cache_control).toEqual(hour)
                expect(sent.provider).toEqual({ order: ['anthropic'] })
                expect(sent.messages).toEqual([
                    { role: 'system', content: [{ type: 'text', text: 'stable rules', cache_control: hour }] },
                    { role: 'system', content: [{ type: 'text', text: 'today is Monday', cache_control: hour }] },
                    { role: 'user', content: 'hi' },
                ])
            } else {
                expect(sent.cache_control).toBeUndefined()
                expect(sent.provider).toBeUndefined()
                expect(sent.messages).toEqual(messages)
            }
        }
    })

    // A box still on the id Balanced used to be gets the current model rather than a 400, and the
    // shared key cannot be pointed at a model of the caller's choosing.
    it('rewrites anything that is not a tier into Balanced', async () => {
        expect(await upstreamModelFor('qwen/qwen3.7-max')).toBe(RERUN_UPSTREAM_MODELS.balanced)
        expect(await upstreamModelFor('anthropic/claude-fable-5.1')).toBe(RERUN_UPSTREAM_MODELS.balanced)
    })

    it('bills the call to the coworker the box names', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [], usage: { cost: 0.001 } }))
        vi.mocked(recordRerunUsage).mockResolvedValue()
        const req = request()
        req.headers.set('x-rerun-agent', 'prospector')

        await (await POST(req)).text()

        expect(recordRerunUsage).toHaveBeenLastCalledWith(expect.objectContaining({ engineAgentId: 'prospector' }))
    })

    // A box that gives up on a call (its run stopped, its tool timed out) must not leave OpenRouter
    // generating, and billing, an answer nobody will read.
    it('cancels the upstream stream when the box hangs up', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [] }))
        const box = new AbortController()
        const req = request(RERUN_MODEL, { stream: true })

        await POST(new Request(req, { signal: box.signal }))
        box.abort()

        const init = fetchMock.mock.calls[0]?.[1] as RequestInit
        expect(init.signal?.aborted).toBe(true)
    })

    // OpenRouter bills a non-streaming answer in full even when the call is cancelled, so the only
    // thing an abort would achieve is losing the usage frame the budget is decremented from.
    it('keeps a non-streaming call alive so its cost is still recorded', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ choices: [] }))
        const box = new AbortController()
        const req = request()

        await POST(new Request(req, { signal: box.signal }))
        box.abort()

        const init = fetchMock.mock.calls[0]?.[1] as RequestInit
        expect(init.signal).toBeUndefined()
    })

    // The box only keeps "Provider returned error"; the reason the model provider gave is in the body.
    it('logs the body of a refused call and still hands it to the box untouched', async () => {
        const refusal = JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw: 'messages.3: text content blocks must be non-empty', provider_name: 'Anthropic' } } })
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(refusal, { status: 400 }))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

        const res = await POST(request())

        expect(res.status).toBe(400)
        expect(await res.text()).toBe(refusal)
        await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('[llm] upstream refused', expect.objectContaining({ status: 400, workspaceId: 1, body: refusal })))
    })

    it('does not fall back to the hub key', async () => {
        delete process.env.RERUN_MAX_API_KEY
        const fetchMock = vi.spyOn(globalThis, 'fetch')

        const res = await POST(request())

        expect(res.status).toBe(503)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
