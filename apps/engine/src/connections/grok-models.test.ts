import { vi } from 'vitest'

vi.mock('./grok-token.js', () => ({
    grokAccessToken: (connection: { env: Record<string, string> }) => connection.env.GROK_OAUTH_TOKEN,
    ensureGrokToken: async () => {},
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { cliServesModel } = await import('@rerun/contracts')
const { grokChatModels, refreshGrokModels } = await import('./grok-models.js')
const { forgetCliModels, readCliModels } = await import('./cli-models.js')

const realFetch = globalThis.fetch

// `GET /v1/models` as the proxy answered a paid Grok account on 2026-11-26, trimmed to what is read.
const LISTED = {
    object: 'list',
    data: [
        { id: 'grok-4.7', object: 'model', name: 'Grok 4.7', context_window: 256000, api_backend: 'responses', reasoning_effort: 'high' },
        { id: 'grok-4.7-build-fast', object: 'model', name: 'Grok 4.7 Fast', context_window: 256000, api_backend: 'responses' },
        { id: 'grok-4.6', object: 'model', name: 'Grok 4.6', context_window: 256000, api_backend: 'responses' },
        { id: 'grok-4.5', object: 'model', name: 'Grok 4.5', context_window: 256000, api_backend: 'responses' },
        { id: 'grok-imagine', object: 'model', api_backend: 'images' },
    ],
}

const connection = { id: 'grokcnx', config: { name: 'Grok', provider: 'grok' as const, models: ['grok-4.6'], extraModels: [], createdAt: '' }, env: { GROK_OAUTH_TOKEN: 'access-1' } }

let answer: () => Response
const urls: string[] = []

beforeEach(() => {
    forgetCliModels('grokcnx')
    urls.length = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
        urls.push(String(input))
        return answer()
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

describe('the models a Grok account is served', () => {
    it('keeps the chat models and leaves the others out', () => {
        expect(grokChatModels(LISTED)).toEqual(['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'])
        expect(grokChatModels({ data: 'nope' })).toEqual([])
        expect(grokChatModels(null)).toEqual([])
    })

    it('is read from the proxy and locks a model the account is not served', async () => {
        answer = () => Response.json({ ...LISTED, data: LISTED.data.filter(model => model.id !== 'grok-4.7') })
        await refreshGrokModels(connection)
        expect(urls).toEqual(['https://cli-chat-proxy.grok.com/v1/models'])
        const reading = readCliModels('grokcnx')
        expect(reading).toMatchObject({ models: ['grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'], version: null, outdated: false })
        expect(cliServesModel('grok', reading, 'grok-4.7')).toBe(false)
        expect(cliServesModel('grok', reading, 'grok-4.6')).toBe(true)
    })

    it('refuses nothing when the list cannot be read', async () => {
        answer = () => new Response('{}', { status: 500 })
        await refreshGrokModels(connection)
        expect(readCliModels('grokcnx')).toBeNull()
        expect(cliServesModel('grok', null, 'grok-4.7')).toBe(true)
    })
})
