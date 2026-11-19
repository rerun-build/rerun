import { hubEndpoint, mobileApi } from '@rerun/contracts'

import { ApiError, createApiClient, createHubClient } from '@/api/client'
import { setCurrentLocale, translatorFor } from '@/i18n/translator'

type Call = { url: string; init: RequestInit }

function clientAnswering(response: Response) {
    const calls: Call[] = []
    const fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return response
    }) as unknown as typeof globalThis.fetch
    return { request: createApiClient({ baseUrl: 'https://staging.rerun.build', clientHeader: 'ios/1.0.0 (6)', fetch }), calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createApiClient', () => {
    it('names the build on every call, signed in or not', async () => {
        const { request, calls } = clientAnswering(json({ minBuild: 0 }))
        await request('/api/v1/client')
        expect(calls[0].url).toBe('https://staging.rerun.build/api/v1/client')
        expect(calls[0].init.headers).toEqual({ Accept: 'application/json', 'x-rerun-client': 'ios/1.0.0 (6)' })
    })

    it('carries the token, the workspace and a JSON body', async () => {
        const { request, calls } = clientAnswering(json({ ok: true }))
        await request('/api/v1/to-handle/read', { method: 'POST', body: { all: true }, accessToken: 'jwt', workspaceId: 7 })
        expect(calls[0].init).toMatchObject({
            method: 'POST',
            body: '{"all":true}',
            headers: { Authorization: 'Bearer jwt', 'x-workspace-id': '7', 'Content-Type': 'application/json' },
        })
    })

    it('reads a 204 as no payload', async () => {
        const { request } = clientAnswering(new Response(null, { status: 204 }))
        await expect(request('/api/v1/conversations/c-1/stop', { method: 'POST' })).resolves.toBeUndefined()
    })

    it('throws the status and the message the hub gave', async () => {
        const { request } = clientAnswering(json({ error: 'Unauthorized' }, 401))
        const failure = await request('/api/v1/me').catch(error => error)
        expect(failure).toBeInstanceOf(ApiError)
        expect(failure).toMatchObject({ status: 401, message: 'Unauthorized' })
    })

    it('still throws a readable error when the body is not JSON', async () => {
        const { request } = clientAnswering(new Response('<html>Bad gateway</html>', { status: 502 }))
        await expect(request('/api/v1/me')).rejects.toMatchObject({ status: 502, message: 'Request failed with 502' })
    })

    describe('a refusal with a code', () => {
        beforeEach(() => setCurrentLocale('fr'))
        afterEach(() => setCurrentLocale('en'))

        it('reads a code the app knows in the reader language, and keeps the code and its params', async () => {
            const { request } = clientAnswering(json({ error: 'Keep the name under 40 characters', code: 'nameTooLong', params: { max: 40 } }, 422))
            const failure = await request('/api/v1/agents').catch(error => error)
            const french = translatorFor('errors')('nameTooLong', { max: 40 })
            expect(french).not.toBe('Keep the name under 40 characters')
            expect(failure).toMatchObject({ status: 422, message: french, code: 'nameTooLong', params: { max: 40 } })
        })

        it('falls back to the hub English for a code the app has never heard of', async () => {
            const { request } = clientAnswering(json({ error: 'A refusal from a newer hub', code: 'notInThisBuild' }, 422))
            await expect(request('/api/v1/agents')).rejects.toMatchObject({ status: 422, message: 'A refusal from a newer hub', code: 'notInThisBuild' })
        })

        it('falls back to the request failure text when the hub sent nothing', async () => {
            const { request } = clientAnswering(new Response(null, { status: 500 }))
            await expect(request('/api/v1/me')).rejects.toMatchObject({ status: 500, message: translatorFor('mobileCommon')('errors.requestFailed', { status: 500 }), code: null })
        })
    })
})

describe('createHubClient', () => {
    function hubAnswering(response: Response) {
        const { request, calls } = clientAnswering(response)
        return { hub: createHubClient(request), calls }
    }

    it('sends the method and the path of the registry, its parameters encoded', async () => {
        const { hub, calls } = hubAnswering(json({ supported: true }))
        await hub(mobileApi.setAgentRoutineEnabled, { params: { id: 'agent 1', kind: 'schedule', slug: 'daily/brief' }, body: { enabled: false }, accessToken: 'jwt', workspaceId: 7 })
        expect(calls[0].url).toBe('https://staging.rerun.build/api/v1/agents/agent%201/routines/schedule/daily%2Fbrief')
        expect(calls[0].init).toMatchObject({ method: 'PATCH', body: '{"enabled":false}' })
    })

    it('puts the query in the path, leaving out what is not set', async () => {
        const urls: string[] = []
        for (const query of [{}, { keepOpen: '1' as const }]) {
            const { hub, calls } = hubAnswering(json({ url: null, open: false }))
            await hub(mobileApi.finishTakeover, { params: { id: 'a-1' }, query })
            urls.push(calls[0].url)
        }
        expect(urls).toEqual(['https://staging.rerun.build/api/v1/agents/a-1/desktop/takeover', 'https://staging.rerun.build/api/v1/agents/a-1/desktop/takeover?keepOpen=1'])
    })

    it('reads the answer with the schema the hub promised', async () => {
        const { hub } = hubAnswering(json({ runId: 'run-1', extra: 'ignored' }))
        await expect(hub(mobileApi.getActiveRun, { params: { id: 'c-1' } })).resolves.toEqual({ runId: 'run-1' })
    })

    it('refuses an answer the schema cannot read rather than handing it on', async () => {
        const { hub } = hubAnswering(json({ runId: 42 }))
        await expect(hub(mobileApi.getActiveRun, { params: { id: 'c-1' } })).rejects.toThrow()
    })

    it('leaves out what this build cannot read, and says so', async () => {
        const { request } = clientAnswering(json([{ id: 'a1', name: 'Scout', handle: null, description: null, templateId: null, status: 'hibernating', workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null }]))
        const salvaged = jest.fn()
        await expect(createHubClient(request, { onSalvage: salvaged })(mobileApi.listAgents, {})).resolves.toEqual([])
        expect(salvaged).toHaveBeenCalledWith('GET /api/v1/agents', ['0'])
    })

    it('says it once per call, however often the app repeats that call', async () => {
        const unreadable = { id: 'a1', name: 'Scout', handle: null, description: null, templateId: null, status: 'hibernating', workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null }
        const me = { user: { id: 'u1', email: null, name: 'Ada', avatarUrl: null }, workspace: { id: 7, name: 'Atelier Nord', iconUrl: null, plan: 'pro', subscribed: true, role: 'owner-of-everything', boxScope: 'all' } }
        const request = (async (path: string) => (path === '/api/v1/agents' ? [unreadable] : me)) as Parameters<typeof createHubClient>[0]
        const salvaged = jest.fn()
        const hub = createHubClient(request, { onSalvage: salvaged })
        await hub(mobileApi.listAgents, {})
        await hub(mobileApi.listAgents, {})
        expect(salvaged).toHaveBeenCalledTimes(1)
        await hub(mobileApi.getMe, {})
        expect(salvaged).toHaveBeenLastCalledWith('GET /api/v1/me', ['workspace.role'])
        expect(salvaged).toHaveBeenCalledTimes(2)
    })

    it('reads nothing from a call whose answer the app ignores', async () => {
        const { hub } = hubAnswering(json({ released: { workspace: 1 } }))
        await expect(hub(mobileApi.deleteAiConnection, { params: { id: 'cnx-1' } })).resolves.toBeUndefined()
    })

    it('throws the status of a failure, as the raw client does', async () => {
        const { hub } = hubAnswering(json({ error: 'This page changed again since.' }, 409))
        await expect(hub(mobileApi.revertBrainPage, { params: { slug: 'pricing' }, body: { revisionId: 'r-1' } })).rejects.toMatchObject({ status: 409, message: 'This page changed again since.' })
    })

    it('refuses a path parameter left empty instead of calling another route', async () => {
        const { hub, calls } = hubAnswering(json({}))
        const endpoint = hubEndpoint({ method: 'GET', path: '/api/v1/agents/{id}', response: 'none' })
        await expect(hub(endpoint, { params: { id: '' } })).rejects.toThrow('needs id')
        expect(calls).toHaveLength(0)
    })
})
