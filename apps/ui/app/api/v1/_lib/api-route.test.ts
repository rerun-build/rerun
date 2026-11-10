import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ requireWorkspaceContext: vi.fn(), requireAdminContext: vi.fn() }))

vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    getRequestAccessToken: async () => null,
}))

vi.mock('@/app/api/_auth/ownership', async () => {
    class AuthorizationError extends Error {}
    class UnauthenticatedError extends AuthorizationError {}
    return {
        AuthorizationError,
        UnauthenticatedError,
        requireWorkspaceContext: mocks.requireWorkspaceContext,
        requireAdminContext: mocks.requireAdminContext,
    }
})

const { apiRoute, ApiError } = await import('./api-route')
const { AuthorizationError, UnauthenticatedError } = await import('@/app/api/_auth/ownership')

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

    it('answers 500 without leaking the message of an unexpected failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const route = apiRoute({ auth: 'member' }, async () => {
            throw new Error('database password is hunter2')
        })
        const res = await route(post(''), segment)
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal error' })
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
})
