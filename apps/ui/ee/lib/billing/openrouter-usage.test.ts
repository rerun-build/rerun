import { afterEach, describe, expect, it, vi } from 'vitest'
import { meteredFetch } from './openrouter-usage'

const answer = { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 } }

function decodedGzipAnswer(): Response {
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '123' } })
}

describe('meteredFetch', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('stops announcing a compression the non-streamed body no longer has', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => decodedGzipAnswer())

        const res = await meteredFetch(() => {})('https://openrouter.test', { method: 'POST', body: '{}' })

        expect(res.headers.get('content-encoding')).toBeNull()
        expect(res.headers.get('content-length')).toBeNull()
        expect(res.headers.get('content-type')).toBe('application/json')
        expect(await res.json()).toEqual(answer)
    })

    it('reads the cost of a non-streamed answer', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => decodedGzipAnswer())
        const onUsage = vi.fn()

        await meteredFetch(onUsage)('https://openrouter.test', { method: 'POST', body: '{}' })

        expect(onUsage).toHaveBeenCalledWith(answer.usage)
    })

    it('adds what the provider billed on our own key to the fee OpenRouter charged', async () => {
        const usage = { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001, cost_details: { upstream_inference_cost: 0.002 } }
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [], usage }))
        const onUsage = vi.fn()

        await meteredFetch(onUsage)('https://openrouter.test', { method: 'POST', body: '{}' })

        expect(onUsage.mock.calls[0]?.[0].cost).toBeCloseTo(0.0021, 10)
    })

    it('keeps the cost as it is when the call did not run on our own key', async () => {
        const usage = { prompt_tokens: 10, completion_tokens: 2, cost: 0.002, cost_details: { upstream_inference_cost: null } }
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ choices: [], usage }))
        const onUsage = vi.fn()

        await meteredFetch(onUsage)('https://openrouter.test', { method: 'POST', body: '{}' })

        expect(onUsage).toHaveBeenCalledWith(usage)
    })

    it('adds the provider bill read off the last frame of a stream', async () => {
        const frames = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001, cost_details: { upstream_inference_cost: 0.002 } } })}\n\n`,
            'data: [DONE]\n\n',
        ]
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(frames.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
        const onUsage = vi.fn()

        const res = await meteredFetch(onUsage)('https://openrouter.test', { method: 'POST', body: '{}' })

        expect(await res.text()).toBe(frames.join(''))
        expect(onUsage).toHaveBeenCalledTimes(1)
        expect(onUsage.mock.calls[0]?.[0].cost).toBeCloseTo(0.0021, 10)
    })

    it('asks OpenRouter for the cost', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => decodedGzipAnswer())

        await meteredFetch(() => {})('https://openrouter.test', { method: 'POST', body: JSON.stringify({ model: 'm' }) })

        const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
        expect(sent).toEqual({ model: 'm', usage: { include: true } })
    })
})
