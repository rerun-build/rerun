import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

// The column used to ask for the skill proposals waiting in a conversation in a call of its own,
// on every board load. They now come with the conversation it reads.

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), listSkillProposals: vi.fn(), getSessionMessages: vi.fn(), updates: [] as Array<{ patch: unknown; filters: Array<[string, unknown]> }> }))

// What the read writes back: a thread a check-in left waiting stops waiting once opened.
function updateChain() {
    return {
        update: (patch: unknown) => {
            const entry = { patch, filters: [] as Array<[string, unknown]> }
            mocks.updates.push(entry)
            const chain = {
                eq: (column: string, value: unknown) => {
                    entry.filters.push([column, value])
                    return chain
                },
                select: () => chain,
                then: (resolve: (value: { data: []; error: null }) => unknown) => resolve({ data: [], error: null }),
            }
            return chain
        },
    }
}

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => updateChain() }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectMany: vi.fn(), selectMaybeSingleWithJoins: vi.fn() }))
vi.mock('./agent-row', () => ({ ensureForemanAgentRow: async () => 'agent-cos' }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn(async () => ({ baseUrl: 'https://engine.test', apiKey: null })) }))
vi.mock('@/app/api/_services/chat.service', () => ({
    FIRST_MESSAGE_MAX_CHARS: 200,
    GENERAL_SESSION_TITLE: 'General',
    listSessionRuns: vi.fn(async () => ({})),
    readUsageSeed: vi.fn(),
    lastRunError: () => null,
}))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn() }))
vi.mock('@/lib/chat/engine-history', () => ({ transformEngineMessages: (messages: unknown[]) => messages }))
vi.mock('@/lib/engine/client', () => ({ listSkillProposals: mocks.listSkillProposals, getSessionMessages: mocks.getSessionMessages, cancelRun: vi.fn(), listRuns: vi.fn() }))

const { loadForemanConversationById } = await import('./conversation')

const ctx = { userId: 'user-1', workspace: { id: 7 } } as WorkspaceContext
const waiting = { id: 'p-1', status: 'pending', createdAt: '2026-11-18T09:00:00.000Z' }

describe('a Chief of Staff conversation read with its skill proposals', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1', title: 'Weekly report', engine_session_id: 'engine-1', kind: 'thread' } })
        mocks.getSessionMessages.mockResolvedValue([{ id: 'm1' }])
        mocks.listSkillProposals.mockResolvedValue([waiting])
    })

    it('hands over the proposals waiting in it', async () => {
        const conversation = await loadForemanConversationById(ctx, 'row-1')

        expect(conversation?.proposals).toEqual([waiting])
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(expect.anything(), 'foreman', 'engine-1')
    })

    it('still opens on its transcript when the engine keeps no skills for it', async () => {
        mocks.listSkillProposals.mockRejectedValue(new Error('rerun-engine GET /agents/foreman/skill-proposals failed: 403'))

        const conversation = await loadForemanConversationById(ctx, 'row-1')

        expect(conversation?.messages).toEqual([{ id: 'm1' }])
        expect(conversation?.proposals).toEqual([])
    })
})

describe('a Chief of Staff thread a check-in left waiting', () => {
    beforeEach(() => {
        mocks.updates.length = 0
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-2', title: 'Invoices keep failing', engine_session_id: 'engine-2', kind: 'thread' } })
        mocks.getSessionMessages.mockResolvedValue([])
        mocks.listSkillProposals.mockResolvedValue([])
    })

    it('stops waiting once its reader opens it, and only if it was still waiting on them', async () => {
        await loadForemanConversationById(ctx, 'row-2')
        expect(mocks.updates).toEqual([{ patch: { status: 'idle' }, filters: [['id', 'row-2'], ['owner_user_id', 'user-1'], ['status', 'awaiting_ack']] }])
    })

    it('writes nothing for a conversation that is not theirs', async () => {
        mocks.selectMaybeSingle.mockClear()
        mocks.selectMaybeSingle.mockResolvedValue({ data: null })
        expect(await loadForemanConversationById(ctx, 'row-2')).toBeNull()
        expect(mocks.updates).toEqual([])
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ agent_id: 'agent-cos', owner_user_id: 'user-1', id: 'row-2' })
    })
})

