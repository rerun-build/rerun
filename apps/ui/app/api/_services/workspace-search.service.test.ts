import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
    selectMany: vi.fn(),
    visibleSpaceIds: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    searchWorkspace: vi.fn(),
}))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: mocks.selectMany }))
vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), visibleSpaceIds: mocks.visibleSpaceIds }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: mocks.getWorkspaceConnection }))
vi.mock('@/lib/engine/client', () => ({ searchWorkspace: mocks.searchWorkspace }))

const { searchWorkspaceContent } = await import('./workspace-search.service')

const ctx = { userId: 'u1', role: 'member', boxScope: 'restricted', workspace: { id: 7 }, supabase: {} } as unknown as WorkspaceContext

const AGENTS = [
    { id: 'ada', engine_agent_id: 'eng-ada', space_id: 'growth' },
    { id: 'iris', engine_agent_id: 'eng-iris', space_id: 'finance' },
    { id: 'new', engine_agent_id: null, space_id: 'growth' },
]

describe('searchWorkspaceContent', () => {
    beforeEach(() => {
        Object.values(mocks).forEach(mock => mock.mockReset())
        mocks.selectMany.mockResolvedValue({ data: AGENTS, error: null })
        mocks.visibleSpaceIds.mockResolvedValue(new Set(['growth']))
        mocks.getWorkspaceConnection.mockResolvedValue({ baseUrl: 'http://box' })
    })

    it('asks the machine only about the coworkers whose Box the caller reaches, and answers with their app ids', async () => {
        mocks.searchWorkspace.mockResolvedValue({
            truncated: false,
            hits: [
                { kind: 'coworker', agentId: 'eng-ada', field: 'soul', line: 2, snippet: 'boost' },
                { kind: 'file', agentId: null, path: 'plan.md', line: 1, snippet: 'boost' },
                { kind: 'table', agentId: 'eng-iris', table: 'ledger', rowId: 1, title: 'x', snippet: 'boost' },
                { kind: 'brain', slug: 'ads', title: 'Ads', snippet: 'boost' },
            ],
        })
        const answer = await searchWorkspaceContent(ctx, '  boost ')
        expect(mocks.searchWorkspace).toHaveBeenCalledWith({ baseUrl: 'http://box' }, 'boost', ['eng-ada'], undefined)
        expect(mocks.selectMany).toHaveBeenCalledWith({}, 'agents', ['id', 'engine_agent_id', 'space_id'], { workspace_id: 7, kind: 'coworker' })
        expect(answer).toEqual({
            truncated: false,
            unavailable: false,
            hits: [
                { kind: 'coworker', agentId: 'ada', field: 'soul', line: 2, snippet: 'boost' },
                { kind: 'file', agentId: null, path: 'plan.md', line: 1, snippet: 'boost' },
                { kind: 'brain', slug: 'ads', title: 'Ads', snippet: 'boost' },
            ],
        })
    })

    it('does not reach the machine for less than two characters', async () => {
        expect(await searchWorkspaceContent(ctx, ' b ')).toEqual({ hits: [], truncated: false, unavailable: false })
        expect(mocks.searchWorkspace).not.toHaveBeenCalled()
    })

    it('reports a query the machine would refuse as too long, without asking it', async () => {
        expect(await searchWorkspaceContent(ctx, 'b'.repeat(201))).toEqual({ hits: [], truncated: false, unavailable: true })
        expect(mocks.searchWorkspace).not.toHaveBeenCalled()
    })

    it('hands the caller’s signal to the machine, and says when it stopped early', async () => {
        const { signal } = new AbortController()
        mocks.searchWorkspace.mockResolvedValue({ hits: [], truncated: true })
        expect(await searchWorkspaceContent(ctx, 'boost', signal)).toEqual({ hits: [], truncated: true, unavailable: false })
        expect(mocks.searchWorkspace.mock.calls[0][3]).toBe(signal)
    })

    it('reports a machine that cannot answer, without failing', async () => {
        mocks.searchWorkspace.mockRejectedValue(new Error('404'))
        expect(await searchWorkspaceContent(ctx, 'boost')).toEqual({ hits: [], truncated: false, unavailable: true })
    })

    it('fails when the coworkers cannot be read', async () => {
        mocks.selectMany.mockResolvedValue({ data: null, error: new Error('db down') })
        await expect(searchWorkspaceContent(ctx, 'boost')).rejects.toThrow('db down')
    })
})
