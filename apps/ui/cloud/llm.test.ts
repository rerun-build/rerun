import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(async () => ({ workspaceId: 1 })) }))

const { rerunChatCompletions } = await import('./llm')

const request = () => new Request('http://app/api/llm/chat/completions', { method: 'POST', headers: { authorization: 'Bearer box' }, body: JSON.stringify({ model: 'rerun-pro', messages: [] }) })

describe('rerunChatCompletions', () => {
    beforeEach(() => vi.stubEnv('OPENROUTER_API_KEY', 'sk-test'))
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('drops the encoding of a body fetch has already decompressed, so a call that does not stream can parse it', async () => {
        const answer = JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
        vi.stubGlobal('fetch', vi.fn(async () => new Response(answer, { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '12' } })))

        const response = await rerunChatCompletions(request())

        expect(response.headers.get('content-encoding')).toBeNull()
        expect(response.headers.get('content-length')).toBeNull()
        expect(response.headers.get('content-type')).toBe('application/json')
        await expect(response.text()).resolves.toBe(answer)
    })

    it('answers without a key in the OpenAI error shape, with a status the engine neither retries nor reads as overloaded', async () => {
        vi.stubEnv('OPENROUTER_API_KEY', '')
        const upstream = vi.fn()
        vi.stubGlobal('fetch', upstream)

        const response = await rerunChatCompletions(request())

        expect(response.status).toBe(403)
        const body = (await response.json()) as { error: { message: string } }
        expect(body.error.message).toContain('OPENROUTER_API_KEY')
        expect(upstream).not.toHaveBeenCalled()
    })

    it('keeps the status of a refusal', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'nope' }, { status: 402 })))
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect((await rerunChatCompletions(request())).status).toBe(402)
    })
})
