import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({
    requireWorkspaceContext: vi.fn(),
    requireLightSessionActor: vi.fn(),
    assertSessionInWorkspace: vi.fn(),
    assertAgentInWorkspace: vi.fn(),
    readSessionMessages: vi.fn(),
}))

vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceContext: mocks.requireWorkspaceContext }))
vi.mock('@/app/api/_auth/access', () => ({
    actorFromContext: (ctx: { userId: string; workspace: { id: number }; role: string; boxScope: string }) => ({ kind: 'user', userId: ctx.userId, workspaceId: ctx.workspace.id, role: ctx.role, boxScope: ctx.boxScope }),
    isAdminActor: (actor: { kind: string; role?: string }) => actor.kind === 'workspace' || actor.role === 'admin',
    requireLightSessionActor: mocks.requireLightSessionActor,
    assertSessionInWorkspace: mocks.assertSessionInWorkspace,
    assertAgentInWorkspace: mocks.assertAgentInWorkspace,
}))
vi.mock('@/app/api/_services/conversation.service', () => ({ readSessionMessages: mocks.readSessionMessages }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { clearMessageFeedbackAction, rateMessageAction, updateMessageFeedbackAction } = await import('./message-feedback.actions')

const WORKSPACE_ID = 7
const SESSION_ID = '6f1c1c4e-2b7a-4f7e-9a59-0d6e3f1b2c3d'
const FEEDBACK_ID = '0a8f5b9e-1c2d-4e3f-8a7b-6c5d4e3f2a1b'
const ADMIN = { kind: 'user', userId: 'user-me', workspaceId: WORKSPACE_ID, role: 'admin', boxScope: 'all' }
const MEMBER = { ...ADMIN, role: 'member' }
const TRANSCRIPT = [{ id: 'engine-1', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }]

let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    db = fakeSupabase(table => (table === 'message_feedback' ? { data: { id: FEEDBACK_ID } } : undefined))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    mocks.requireWorkspaceContext.mockResolvedValue({ userId: 'user-me', workspace: { id: WORKSPACE_ID }, role: 'admin', boxScope: 'all', supabase: db.client })
    mocks.requireLightSessionActor.mockResolvedValue(ADMIN)
    mocks.assertSessionInWorkspace.mockResolvedValue({ id: SESSION_ID, agent_id: 'agent-1' })
    mocks.readSessionMessages.mockResolvedValue(TRANSCRIPT)
})

describe('rateMessageAction', () => {
    it('upserts the vote with a snapshot of the conversation and resets earlier details', async () => {
        await expect(rateMessageAction({ sessionId: SESSION_ID, messageId: 'engine-1', rating: 'down', messageText: 'Done.' })).resolves.toEqual({ ok: true, id: FEEDBACK_ID })
        expect(mocks.assertSessionInWorkspace).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ kind: 'user', userId: 'user-me', workspaceId: WORKSPACE_ID }))

        const [write] = db.writes('message_feedback')
        expect(write.method).toBe('upsert')
        expect(write.payload).toMatchObject({
            workspace_id: WORKSPACE_ID,
            user_id: 'user-me',
            agent_id: 'agent-1',
            session_id: SESSION_ID,
            message_id: 'engine-1',
            rating: 'down',
            category: null,
            details: null,
            transcript: TRANSCRIPT,
        })
    })

    it('refuses a vote on a message the conversation does not hold, without writing', async () => {
        await expect(rateMessageAction({ sessionId: SESSION_ID, messageId: 'made-up', rating: 'up', messageText: 'Hi' })).resolves.toEqual({ ok: false, error: 'Message not found', code: 'messageNotFound' })
        expect(db.writes('message_feedback')).toHaveLength(0)
    })

    it('still records the vote when the engine cannot be reached', async () => {
        mocks.readSessionMessages.mockRejectedValue(new Error('box down'))

        await expect(rateMessageAction({ sessionId: SESSION_ID, messageId: 'm1', rating: 'up', messageText: 'Hi' })).resolves.toEqual({ ok: true, id: FEEDBACK_ID })
        expect(db.writes('message_feedback')[0].payload).toMatchObject({ transcript: [] })
    })

    it('refuses a session outside the workspace without writing', async () => {
        mocks.assertSessionInWorkspace.mockRejectedValue(new Error('Session not found'))

        await expect(rateMessageAction({ sessionId: SESSION_ID, messageId: 'm1', rating: 'up', messageText: 'Hi' })).rejects.toThrow('Session not found')
        expect(db.writes('message_feedback')).toHaveLength(0)
    })

    it('refuses an unknown rating', async () => {
        await expect(rateMessageAction({ sessionId: SESSION_ID, messageId: 'm1', rating: 'meh' as never, messageText: 'Hi' })).resolves.toEqual({ ok: false, error: 'Invalid feedback', code: 'invalidFeedback' })
        expect(db.writes('message_feedback')).toHaveLength(0)
    })
})

describe('updateMessageFeedbackAction', () => {
    it('writes the details on the caller workspace only', async () => {
        await expect(updateMessageFeedbackAction({ id: FEEDBACK_ID, category: 'not_factual', details: '  Wrong date  ' })).resolves.toEqual({ ok: true })

        const [write] = db.writes('message_feedback')
        expect(write.payload).toMatchObject({ category: 'not_factual', details: 'Wrong date' })
        expect(write.filters.map(call => call.args)).toEqual([
            ['id', FEEDBACK_ID],
            ['workspace_id', WORKSPACE_ID],
        ])
    })

    it('refuses a member the details of a vote on a coworker they cannot use, without writing', async () => {
        db = fakeSupabase(table => (table === 'message_feedback' ? { data: { agent_id: 'agent-hidden' } } : undefined))
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        mocks.requireLightSessionActor.mockResolvedValue(MEMBER)
        mocks.assertAgentInWorkspace.mockRejectedValue(new Error('Coworker not found'))

        await expect(updateMessageFeedbackAction({ id: FEEDBACK_ID, category: 'not_factual', details: '' })).resolves.toEqual({ ok: false, error: 'Feedback not found', code: 'feedbackNotFound' })
        expect(mocks.assertAgentInWorkspace).toHaveBeenCalledWith('agent-hidden', 'use', MEMBER)
        expect(db.writes('message_feedback')).toHaveLength(0)
    })

    it('refuses a category outside the list', async () => {
        await expect(updateMessageFeedbackAction({ id: FEEDBACK_ID, category: 'rude' as never, details: '' })).resolves.toEqual({ ok: false, error: 'Invalid feedback', code: 'invalidFeedback' })
        expect(db.writes('message_feedback')).toHaveLength(0)
    })
})

describe('clearMessageFeedbackAction', () => {
    it('deletes the vote on the caller workspace only', async () => {
        await expect(clearMessageFeedbackAction(FEEDBACK_ID)).resolves.toEqual({ ok: true })

        const [write] = db.writes('message_feedback')
        expect(write.method).toBe('delete')
        expect(write.filters.map(call => call.args)).toEqual([
            ['id', FEEDBACK_ID],
            ['workspace_id', WORKSPACE_ID],
        ])
    })

    it('lets a member clear a vote on a coworker they can use', async () => {
        db = fakeSupabase(table => (table === 'message_feedback' ? { data: { agent_id: 'agent-1' } } : undefined))
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        mocks.requireLightSessionActor.mockResolvedValue(MEMBER)
        mocks.assertAgentInWorkspace.mockResolvedValue({ workspace_id: WORKSPACE_ID, space_id: 'space-1', engine_agent_id: 'engine-1' })

        await expect(clearMessageFeedbackAction(FEEDBACK_ID)).resolves.toEqual({ ok: true })
        expect(db.writes('message_feedback')[0].method).toBe('delete')
    })
})
