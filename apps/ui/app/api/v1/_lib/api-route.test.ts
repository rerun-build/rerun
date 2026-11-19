import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hubEndpoint, hubErrorSchema } from '@rerun/contracts'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ requireWorkspaceContext: vi.fn(), requireAdminContext: vi.fn(), recordBuildDay: vi.fn() }))

vi.mock('@/app/api/v1/_lib/build-days', () => ({ recordBuildDay: mocks.recordBuildDay }))

vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    getRequestAccessToken: async () => null,
}))

// The real error classes: AuthorizationError is an AppError, which the order of the checks has to know.
vi.mock('@/app/api/_auth/ownership', async () => {
    const { AuthorizationError, UnauthenticatedError } = await vi.importActual<typeof import('@/app/api/_auth/errors')>('@/app/api/_auth/errors')
    return {
        AuthorizationError,
        UnauthenticatedError,
        requireWorkspaceContext: mocks.requireWorkspaceContext,
        requireAdminContext: mocks.requireAdminContext,
    }
})

const { apiRoute, ApiError } = await import('./api-route')
const { AuthorizationError, UnauthenticatedError } = await import('@/app/api/_auth/ownership')
const { AppError } = await import('@/lib/i18n/action-error')
const { AccessDeniedError } = await import('@/app/api/_auth/access')

const segment = { params: Promise.resolve({}) }

function post(body: string) {
    return new Request('https://app.rerun.build/api/v1/test', { method: 'POST', body })
}

describe('apiRoute', () => {
    beforeEach(() => {
        mocks.requireWorkspaceContext.mockReset()
        mocks.requireWorkspaceContext.mockResolvedValue({ userId: 'user-1' })
        mocks.requireAdminContext.mockReset()
        mocks.requireAdminContext.mockResolvedValue({ userId: 'user-1', role: 'admin' })
    })

    it('answers 403 to a member on an admin route, without running it', async () => {
        mocks.requireAdminContext.mockRejectedValue(new AuthorizationError('adminOnly'))
        const handler = vi.fn(async () => ({ ok: true }))
        const res = await apiRoute({ auth: 'admin' }, handler)(post(''), segment)
        expect(res.status).toBe(403)
        expect(handler).not.toHaveBeenCalled()
    })

    it('runs an admin route for an admin', async () => {
        const res = await apiRoute({ auth: 'admin' }, async ({ ctx }) => ({ role: ctx.role }))(post(''), segment)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ role: 'admin' })
    })

    it('answers 401 when the caller has no identity, so the app refreshes its token', async () => {
        mocks.requireWorkspaceContext.mockRejectedValue(new UnauthenticatedError())
        const res = await apiRoute({ auth: 'member' }, async () => ({ ok: true }))(post(''), segment)
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'Unauthorized', code: 'notAuthenticated' })
    })

    it('answers 401 on a user route without a signed-in user', async () => {
        const res = await apiRoute({ auth: 'user' }, async () => ({ ok: true }))(post(''), segment)
        expect(res.status).toBe(401)
    })

    it('answers 400 with the issues when the body does not match', async () => {
        const route = apiRoute({ auth: 'member', body: z.object({ name: z.string() }) }, async ({ body }) => body)
        const res = await route(post(JSON.stringify({ name: 3 })), segment)
        expect(res.status).toBe(400)
        expect((await res.json()).issues).toHaveLength(1)
    })

    it('answers 400 on malformed JSON', async () => {
        const route = apiRoute({ auth: 'member', body: z.object({}) }, async () => ({}))
        expect((await route(post('{'), segment)).status).toBe(400)
    })

    it('hides a resource outside the workspace behind a 404', async () => {
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new AuthorizationError('coworkerNotFound')
        })
        expect((await route(post(''), segment)).status).toBe(404)
    })

    it('passes an ApiError status through', async () => {
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new ApiError(409, 'Busy')
        })
        const res = await route(post(''), segment)
        expect(res.status).toBe(409)
        expect(await res.json()).toEqual({ error: 'Busy' })
    })

    it('sends the code an ApiError carries beside its English text', async () => {
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new ApiError(404, { error: 'MCP server not found: acme', code: 'mcpServerNotFound', params: { name: 'acme' } })
        })
        const res = await route(post(''), segment)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'MCP server not found: acme', code: 'mcpServerNotFound', params: { name: 'acme' } })
    })

    it('answers 422 with the English text and the code of a refusal meant for the person', async () => {
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new AppError('serviceKeyRejected', { name: 'Buffer' })
        })
        const res = await route(post(''), segment)
        expect(res.status).toBe(422)
        expect(await res.json()).toEqual({ error: 'Buffer refused this key. Check you copied the right one from Buffer, then try again.', code: 'serviceKeyRejected', params: { name: 'Buffer' } })
    })

    it('answers 500 without leaking the message of an unexpected failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new Error('database password is hunter2')
        })
        const res = await route(post(''), segment)
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal error', code: 'generic' })
    })

    it('runs a public route without looking for a caller', async () => {
        const route = apiRoute({ auth: 'public' }, async ({ ctx }) => ({ ctx }))
        const res = await route(post(''), segment)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ctx: null })
        expect(mocks.requireWorkspaceContext).not.toHaveBeenCalled()
    })

    it('names the app build in the log of a failure, to tell an old binary from a hub bug', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new Error('boom')
        })
        const req = new Request('https://app.rerun.build/api/v1/test', { method: 'POST', headers: { 'x-rerun-client': 'ios/1.0.0 (6)' } })
        await route(req, segment)
        expect(log).toHaveBeenLastCalledWith('[api/v1] POST /api/v1/test [ios/1.0.0 (6)] failed', expect.any(Error))
    })

    it('returns the handler result as JSON, and 204 when there is none', async () => {
        const json = await apiRoute({ auth: 'member' }, async () => ({ ok: true }))(post(''), segment)
        expect(await json.json()).toEqual({ ok: true })
        const empty = await apiRoute({ auth: 'member' }, async () => undefined)(post(''), segment)
        expect(empty.status).toBe(204)
    })

    it('counts the build of the app behind a signed-in call, and of nobody on a public one', async () => {
        mocks.recordBuildDay.mockReset()
        const req = new Request('https://app.rerun.build/api/v1/me', { headers: { 'x-rerun-client': 'ios/1.0.2 (38)' } })
        await apiRoute({ auth: 'member' }, async () => ({ ok: true }))(req, segment)
        expect(mocks.recordBuildDay).toHaveBeenCalledWith(req, 'user-1')
        mocks.recordBuildDay.mockReset()
        await apiRoute({ auth: 'public' }, async () => ({ ok: true }))(req, segment)
        expect(mocks.recordBuildDay).not.toHaveBeenCalled()
    })

    it('answers 403 to a member who only uses the Box, not the 422 of a refusal meant for the person', async () => {
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new AccessDeniedError()
        })
        expect((await route(post(''), segment)).status).toBe(403)
    })
})

describe('apiRoute on a mobile endpoint', () => {
    const named = hubEndpoint({ method: 'POST', path: '/api/v1/test/{id}', body: z.object({ name: z.string() }), response: z.object({ name: z.string() }), errors: { 409: z.object({ error: z.string(), reason: z.string() }) } })
    const silent = hubEndpoint({ method: 'POST', path: '/api/v1/test/{id}', response: 'none' })
    const withId = { params: Promise.resolve({ id: 'a-1' }) }
    const send = (body: object) => new Request('https://app.rerun.build/api/v1/test/a-1', { method: 'POST', body: JSON.stringify(body) })

    beforeEach(() => {
        mocks.requireWorkspaceContext.mockReset()
        mocks.requireWorkspaceContext.mockResolvedValue({ userId: 'user-1' })
    })

    it('reads the body with the schema of the registry and hands the path parameters over', async () => {
        const route = apiRoute(named, { auth: 'member' }, async ({ params, body }) => ({ name: `${params.id} ${body.name}` }))
        const res = await route(send({ name: 'Scout' }), withId)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ name: 'a-1 Scout' })
        expect((await route(send({ name: 3 }), withId)).status).toBe(400)
    })

    it('answers 500 rather than a body the app could not read, and says why in the log', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        const route = apiRoute(named, { auth: 'member' }, async () => ({ name: 3 }) as unknown as { name: string })
        const res = await route(send({ name: 'Scout' }), withId)
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Response breaks the mobile contract' })
        expect(log).toHaveBeenCalledWith(expect.stringContaining('breaks the mobile contract: the body'), expect.anything())
    })

    it('answers 500 for a success under another status than the registry says', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const route = apiRoute(silent, { auth: 'member' }, async () => ({ ok: true }))
        expect((await route(send({}), withId)).status).toBe(500)
        expect((await apiRoute(silent, { auth: 'member' }, async () => undefined)(send({}), withId)).status).toBe(204)
    })

    it('checks a refusal the route built against the body the app reads for its status', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const readable = apiRoute(named, { auth: 'member' }, async () => Response.json({ error: 'Taken', reason: 'taken' }, { status: 409 }))
        expect((await readable(send({ name: 'Scout' }), withId)).status).toBe(409)
        const unreadable = apiRoute(named, { auth: 'member' }, async () => Response.json({ error: 'Taken' }, { status: 409 }))
        expect((await unreadable(send({ name: 'Scout' }), withId)).status).toBe(500)
        const other = apiRoute(named, { auth: 'member' }, async () => Response.json({ message: 'no error field' }, { status: 418 }))
        expect((await other(send({ name: 'Scout' }), withId)).status).toBe(500)
    })

    it('names the endpoint it answers for, for the coverage test', () => {
        expect(apiRoute(named, { auth: 'member' }, async () => ({ name: '' })).endpoint).toBe(named)
        expect(hubErrorSchema.safeParse({ error: 'x', extra: 1 }).success).toBe(true)
    })
})
