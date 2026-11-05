import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { providerKeyProblem } = await import('./verify-provider-key')

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function answer(status: number, body = '{}') {
    fetchMock.mockResolvedValue(new Response(body, { status }))
}

beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('providerKeyProblem', () => {
    it.each([
        ['anthropic', 'ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1/models?limit=1', 'Anthropic'],
        ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1/models', 'OpenAI'],
        ['google', 'GOOGLE_GENERATIVE_AI_API_KEY', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', 'Google'],
        ['openrouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/key', 'OpenRouter'],
    ] as const)('asks %s about the key and reports a refusal', async (provider, envKey, url, name) => {
        answer(401)
        expect(await providerKeyProblem(provider, { [envKey]: ' bad-key ' })).toBe(`${name} turned this key down. Check it was copied in full and is still active.`)
        expect(fetchMock.mock.calls[0][0]).toBe(url)
        expect(JSON.stringify(fetchMock.mock.calls[0][1].headers)).toContain('bad-key')
    })

    it('asks OpenCode about the key on its usage endpoint, the only one that checks it', async () => {
        answer(401)
        expect(await providerKeyProblem('opencode', { OPENCODE_API_KEY: 'oc_sk_bad' })).toBe('OpenCode turned this key down. Check it was copied in full and is still active.')
        expect(fetchMock.mock.calls[0][0]).toBe('https://opencode.ai/zen/go/v1/usage')
        expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer oc_sk_bad' })
    })

    // A key with Console credits and no Go plan may be refused the Go usage: it still runs.
    it('lets an OpenCode key through on anything but a 401', async () => {
        answer(403)
        expect(await providerKeyProblem('opencode', { OPENCODE_API_KEY: 'oc_sk_console' })).toBeNull()
        answer(200, JSON.stringify({ usage: {} }))
        expect(await providerKeyProblem('opencode', { OPENCODE_API_KEY: 'oc_sk_go' })).toBeNull()
    })

    it('takes a key its provider accepted', async () => {
        answer(200)
        expect(await providerKeyProblem('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-api03-good' })).toBeNull()
    })

    it('reads a 403 as a refusal too', async () => {
        answer(403)
        expect(await providerKeyProblem('openai', { OPENAI_API_KEY: 'sk-revoked' })).toContain('OpenAI turned this key down')
    })

    it('lets through an OpenAI key that is only short of the scope to list models', async () => {
        answer(401, JSON.stringify({ error: { code: 'missing_scope', message: 'You have insufficient permissions for this operation. Missing scopes: api.model.read' } }))
        expect(await providerKeyProblem('openai', { OPENAI_API_KEY: 'sk-proj-restricted' })).toBeNull()
        answer(401, JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }))
        expect(await providerKeyProblem('openai', { OPENAI_API_KEY: 'sk-proj-wrong' })).toContain('OpenAI turned this key down')
        answer(401, 'not json')
        expect(await providerKeyProblem('openai', { OPENAI_API_KEY: 'sk-proj-wrong' })).toContain('OpenAI turned this key down')
    })

    it('reads the 400 Google answers an unknown key with, and only that one', async () => {
        answer(400, JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }))
        expect(await providerKeyProblem('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-bad' })).toContain('Google turned this key down')
        answer(400, JSON.stringify({ error: { message: 'something else' } }))
        expect(await providerKeyProblem('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-ok' })).toBeNull()
    })

    it.each([
        ['an outage', () => answer(503)],
        ['a rate limit', () => answer(429)],
        ['a network failure', () => fetchMock.mockRejectedValue(new Error('ECONNRESET'))],
    ])('lets the key through on %s', async (_label, arrange) => {
        arrange()
        expect(await providerKeyProblem('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-api03-maybe' })).toBeNull()
    })

    it('turns a Claude plan token away before asking anyone', async () => {
        expect(await providerKeyProblem('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-oat01-plan' })).toBe('This is a Claude plan token. Add it under Claude Pro or Max instead.')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('asks nothing for a plan, the keyless connection, a router of the user own or no key', async () => {
        expect(await providerKeyProblem('claude', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' })).toBeNull()
        expect(await providerKeyProblem('rerun', {})).toBeNull()
        expect(await providerKeyProblem('openrouter', { OPENROUTER_API_KEY: 'k' }, 'https://router.example.com/api')).toBeNull()
        expect(await providerKeyProblem('anthropic', {})).toBeNull()
        expect(await providerKeyProblem('anthropic', undefined)).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
