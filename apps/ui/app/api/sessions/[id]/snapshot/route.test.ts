import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readSessionSnapshot: vi.fn() }))

vi.mock('@/app/api/_services/conversation.service', () => ({ readSessionSnapshot: mocks.readSessionSnapshot }))

const { AuthorizationError, UnauthenticatedError } = await import('@/app/api/_auth/ownership')
const { EMPTY_SESSION_SNAPSHOT } = await import('@/lib/chat/session-snapshot')
const { GET } = await import('./route')

const open = (id = 'session-1') => GET(new Request(`https://app.rerun.build/api/sessions/${id}/snapshot`), { params: Promise.resolve({ id }) })

describe('GET /api/sessions/:id/snapshot', () => {
    beforeEach(() => {
        mocks.readSessionSnapshot.mockReset()
    })

    it('answers what the conversation reopens on', async () => {
        const snapshot = { ...EMPTY_SESSION_SNAPSHOT, messages: [{ id: 'm1', role: 'user', parts: [] }], activeRunId: 'run-1' }
        mocks.readSessionSnapshot.mockResolvedValue(snapshot)

        const response = await open()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(snapshot)
        expect(mocks.readSessionSnapshot).toHaveBeenCalledWith('session-1')
    })

    it('answers 401 to a caller who is not signed in', async () => {
        mocks.readSessionSnapshot.mockRejectedValue(new UnauthenticatedError())
        expect((await open()).status).toBe(401)
    })

    it.each([
        ['out of the caller reach', new AuthorizationError('sessionNotFound')],
        ['on a machine that does not answer', new Error('fetch failed')],
    ])('opens a conversation %s empty, without saying which it is', async (_label, error) => {
        mocks.readSessionSnapshot.mockRejectedValue(error)

        const response = await open()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(EMPTY_SESSION_SNAPSHOT)
    })
})
