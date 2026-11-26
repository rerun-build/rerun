import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageRun } from '@rerun/contracts'

const mocks = vi.hoisted(() => ({
    visibleAgentIds: vi.fn(),
    selectAll: vi.fn(),
    listMemberProfiles: vi.fn(),
    listUsageRuns: vi.fn(),
}))

vi.mock('@/app/api/_auth/access', () => ({ actorFromContext: () => ({ kind: 'user' }), visibleAgentIds: mocks.visibleAgentIds }))
vi.mock('@/app/api/_services/members.service', () => ({ listMemberProfiles: mocks.listMemberProfiles }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: async () => ({ host: 'engine' }) }))
vi.mock('@/lib/engine/client', () => ({
    listUsageRuns: mocks.listUsageRuns,
    EngineRequestError: class EngineRequestError extends Error {
        constructor(
            message: string,
            readonly status: number
        ) {
            super(message)
        }
    },
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectAll: mocks.selectAll }))

const { readWorkspaceUsage, UsageNotSupportedError } = await import('./usage.service')
const { EngineRequestError } = await import('@/lib/engine/client')

const ctx = { workspace: { id: 7 } } as Parameters<typeof readWorkspaceUsage>[0]
const query = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-26T00:00:00.000Z' }

function run(id: string, agentId: string, patch: Partial<UsageRun> = {}): UsageRun {
    return { id, agentId, status: 'done', startedAt: '2026-11-25T10:00:00.000Z', finishedAt: '2026-11-25T10:01:00.000Z', provider: 'rerun', model: 'm', inputTokens: 10, outputTokens: 2, costMicros: 100, starterKind: 'person', starterId: 'u1', starterName: 'Noa', ...patch }
}

beforeEach(() => {
    mocks.selectAll.mockResolvedValue({
        data: [
            { id: 'hub-nova', name: 'Nova', kind: 'coworker', engine_agent_id: 'eng-nova' },
            { id: 'hub-atlas', name: 'Atlas', kind: 'coworker', engine_agent_id: 'eng-atlas' },
            { id: 'hub-draft', name: 'Draft', kind: 'coworker', engine_agent_id: null },
        ],
    })
    mocks.listMemberProfiles.mockResolvedValue([{ id: 'u1', name: 'Noa Levi', avatarUrl: null, role: 'member' }])
    mocks.listUsageRuns.mockResolvedValue({
        runs: [run('r1', 'eng-nova'), run('r2', 'eng-atlas', { starterKind: 'coworker', starterId: 'eng-nova', starterName: null }), run('r3', 'eng-gone')],
        truncated: false,
    })
})

describe('readWorkspaceUsage', () => {
    it('names every run by the coworker of the app, and the calling coworker too', async () => {
        mocks.visibleAgentIds.mockResolvedValue('all')
        const usage = await readWorkspaceUsage(ctx, query)
        expect(usage.runs.map(r => [r.id, r.coworkerId, r.starterKind, r.starterId])).toEqual([
            ['r1', 'hub-nova', 'person', 'u1'],
            ['r2', 'hub-atlas', 'coworker', 'hub-nova'],
        ])
        expect(usage.coworkers).toEqual([
            { id: 'hub-nova', name: 'Nova', kind: 'coworker' },
            { id: 'hub-atlas', name: 'Atlas', kind: 'coworker' },
        ])
        expect(mocks.listUsageRuns).toHaveBeenCalledWith({ host: 'engine' }, query, undefined)
        expect(usage.people).toEqual([{ id: 'u1', name: 'Noa Levi', avatarUrl: null }])
    })

    it('keeps out the runs of the coworkers a member does not reach', async () => {
        mocks.visibleAgentIds.mockResolvedValue(new Set(['hub-atlas']))
        const usage = await readWorkspaceUsage(ctx, query)
        expect(usage.runs.map(r => r.id)).toEqual(['r2'])
        expect(usage.runs[0]).toMatchObject({ starterKind: 'coworker', starterId: null })
        expect(usage.coworkers.map(c => c.id)).toEqual(['hub-atlas'])
        expect(mocks.listUsageRuns).toHaveBeenCalledWith({ host: 'engine' }, query, ['eng-atlas'])
    })

    it('tells an engine without the usage route from one that does not answer', async () => {
        mocks.visibleAgentIds.mockResolvedValue('all')
        mocks.listUsageRuns.mockRejectedValueOnce(new EngineRequestError('not found', 404))
        await expect(readWorkspaceUsage(ctx, query)).rejects.toBeInstanceOf(UsageNotSupportedError)
        mocks.listUsageRuns.mockRejectedValueOnce(new EngineRequestError('boom', 502))
        await expect(readWorkspaceUsage(ctx, query)).rejects.not.toBeInstanceOf(UsageNotSupportedError)
    })
})
