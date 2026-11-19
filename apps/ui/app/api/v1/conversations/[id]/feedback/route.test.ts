import { beforeEach, describe, expect, it, vi } from 'vitest'

const rateMessageAction = vi.fn()
const fetchSessionFeedbackAction = vi.fn()
const updateMessageFeedbackAction = vi.fn()
const clearMessageFeedbackAction = vi.fn()
vi.mock('@/app/api/_actions/message-feedback.actions', () => ({
    rateMessageAction: (...args: unknown[]) => rateMessageAction(...args),
    fetchSessionFeedbackAction: (...args: unknown[]) => fetchSessionFeedbackAction(...args),
    updateMessageFeedbackAction: (...args: unknown[]) => updateMessageFeedbackAction(...args),
    clearMessageFeedbackAction: (...args: unknown[]) => clearMessageFeedbackAction(...args),
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const conversation = await import('./route')
const feedback = await import('@/app/api/v1/feedback/[id]/route')

const request = (url: string, method: string, body?: object) => new Request(`https://moldwright.robagentic.tech${url}`, { method, body: body ? JSON.stringify(body) : undefined })
const inConversation = { params: Promise.resolve({ id: 'session-1' }) }
const onFeedback = { params: Promise.resolve({ id: 'feedback-1' }) }

describe('/api/v1/conversations/:id/feedback', () => {
    beforeEach(() => {
        rateMessageAction.mockReset().mockResolvedValue({ ok: true, id: 'feedback-1' })
        fetchSessionFeedbackAction.mockReset().mockResolvedValue([{ id: 'feedback-1', messageId: 'm1', rating: 'up' }])
        updateMessageFeedbackAction.mockReset().mockResolvedValue({ ok: true })
        clearMessageFeedbackAction.mockReset().mockResolvedValue({ ok: true })
    })

    it('reads the votes of a coworker conversation by default', async () => {
        const res = await conversation.GET(request('/api/v1/conversations/session-1/feedback', 'GET'), inConversation)
        expect(await res.json()).toEqual({ feedback: [{ id: 'feedback-1', messageId: 'm1', rating: 'up' }] })
        expect(fetchSessionFeedbackAction).toHaveBeenCalledWith('session-1', 'agent')
    })

    it('records a vote and hands back its id', async () => {
        const res = await conversation.POST(request('/api/v1/conversations/session-1/feedback', 'POST', { messageId: 'm1', rating: 'down', messageText: 'Here is the recap.' }), inConversation)
        expect(await res.json()).toEqual({ id: 'feedback-1' })
        expect(rateMessageAction).toHaveBeenCalledWith({ sessionId: 'session-1', scope: 'agent', messageId: 'm1', rating: 'down', messageText: 'Here is the recap.' })
    })

    it('adds the details of a vote, then takes the vote back', async () => {
        expect((await feedback.PATCH(request('/api/v1/feedback/feedback-1', 'PATCH', { category: 'incomplete', details: 'Missed the last deal' }), onFeedback)).status).toBe(204)
        expect(updateMessageFeedbackAction).toHaveBeenCalledWith({ id: 'feedback-1', category: 'incomplete', details: 'Missed the last deal' })
        expect((await feedback.DELETE(request('/api/v1/feedback/feedback-1', 'DELETE'), onFeedback)).status).toBe(204)
        expect(clearMessageFeedbackAction).toHaveBeenCalledWith('feedback-1')
    })

    it('refuses a category the web does not know', async () => {
        const res = await feedback.PATCH(request('/api/v1/feedback/feedback-1', 'PATCH', { category: 'rude', details: '' }), onFeedback)
        expect(res.status).toBe(400)
    })
})
