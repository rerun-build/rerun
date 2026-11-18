import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ assertAgentAccess: vi.fn(), findGeneralSession: vi.fn() }))

vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: mocks.assertAgentAccess }))
vi.mock('@/app/api/_services/chat.service', () => ({ findGeneralSession: mocks.findGeneralSession }))

const { AuthorizationError, UnauthenticatedError } = await import('@/app/api/_auth/ownership')
const { GET } = await import('./route')

const read = (id = 'agent-1') => GET(new Request(`https://app.rerun.build/api/agents/${id}/general`), { params: Promise.resolve({ id }) })

describe('GET /api/agents/:id/general', () => {
    beforeEach(() => {
        mocks.assertAgentAccess.mockReset().mockResolvedValue({})
        mocks.findGeneralSession.mockReset().mockResolvedValue({ id: 'row-g', engineSessionId: 'engine-g' })
    })

    it('answers the General of a coworker the caller can use', async () => {
        const response = await read()

        expect(await response.json()).toEqual({ general: { id: 'row-g', engineSessionId: 'engine-g' } })
        expect(mocks.assertAgentAccess).toHaveBeenCalledWith('agent-1', 'use')
    })

    it('answers null until someone has spoken in it, and when it cannot be read', async () => {
        mocks.findGeneralSession.mockResolvedValue(null)
        expect(await (await read()).json()).toEqual({ general: null })

        mocks.findGeneralSession.mockRejectedValue(new Error('database away'))
        expect(await (await read()).json()).toEqual({ general: null })
    })

    it('answers 401 to a caller who is not signed in, without reading anything', async () => {
        mocks.assertAgentAccess.mockRejectedValue(new UnauthenticatedError())

        expect((await read()).status).toBe(401)
        expect(mocks.findGeneralSession).not.toHaveBeenCalled()
    })

    it('answers 404 for a coworker out of the caller reach, without reading anything', async () => {
        mocks.assertAgentAccess.mockRejectedValue(new AuthorizationError('coworkerNotFound'))

        expect((await read()).status).toBe(404)
        expect(mocks.findGeneralSession).not.toHaveBeenCalled()
    })
})
