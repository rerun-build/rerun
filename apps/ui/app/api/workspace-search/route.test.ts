import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireWorkspaceContext: vi.fn(), searchWorkspaceContent: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: mocks.requireWorkspaceContext }))
vi.mock('@/app/api/_services/workspace-search.service', () => ({ searchWorkspaceContent: mocks.searchWorkspaceContent }))

const { GET } = await import('./route')

const ctx = { workspace: { id: 7 } }
const ANSWER = { hits: [], truncated: true, unavailable: false }

describe('GET /api/workspace-search', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(mock => mock.mockReset())
        mocks.requireWorkspaceContext.mockResolvedValue(ctx)
        mocks.searchWorkspaceContent.mockResolvedValue(ANSWER)
    })

    it('refuses a caller without a workspace', async () => {
        mocks.requireWorkspaceContext.mockRejectedValue(new Error('notAuthenticated'))
        const res = await GET(new Request('http://app/api/workspace-search?q=boost'))
        expect(res.status).toBe(401)
        expect(mocks.searchWorkspaceContent).not.toHaveBeenCalled()
    })

    it('answers the search, cancelled with the request', async () => {
        const controller = new AbortController()
        const res = await GET(new Request('http://app/api/workspace-search?q=100%25+boost', { signal: controller.signal }))
        expect(await res.json()).toEqual(ANSWER)
        const [calledCtx, query, signal] = mocks.searchWorkspaceContent.mock.calls[0]
        expect([calledCtx, query]).toEqual([ctx, '100% boost'])
        controller.abort()
        expect(signal.aborted).toBe(true)
    })

    it('answers 500 when the search itself fails', async () => {
        vi.spyOn(console, 'error').mockImplementationOnce(() => {})
        mocks.searchWorkspaceContent.mockRejectedValue(new Error('db down'))
        expect((await GET(new Request('http://app/api/workspace-search'))).status).toBe(500)
    })
})
