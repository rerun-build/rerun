import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'

// The column used to ask for the skill proposals waiting in a conversation in a call of its own,
// on every board load. They now come with the conversation it reads.

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), listSkillProposals: vi.fn(), getSessionMessages: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectMany: vi.fn() }))
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
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1', title: 'Weekly report', messages: null, backend: 'engine', engine_session_id: 'engine-1', kind: 'thread' } })
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

    it('reads none for a conversation nothing was said in on the engine', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1', title: null, messages: null, backend: 'engine', engine_session_id: null, kind: 'general' } })

        const conversation = await loadForemanConversationById(ctx, 'row-1')

        expect(conversation?.proposals).toEqual([])
        expect(mocks.listSkillProposals).not.toHaveBeenCalled()
    })
})
