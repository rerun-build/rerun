import { ApiError, createApiClient } from '@/api/client'

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
    it('names the build and the time zone on every call, signed in or not', async () => {
        const { request, calls } = clientAnswering(json({ minBuild: 0 }))
        await request('/api/v1/client')
        expect(calls[0].url).toBe('https://staging.rerun.build/api/v1/client')
        expect(calls[0].init.headers).toEqual({ Accept: 'application/json', 'x-rerun-client': 'ios/1.0.0 (6)', 'x-rerun-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone })
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
})
