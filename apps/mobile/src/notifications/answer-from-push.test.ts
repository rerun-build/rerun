import { answerFromPush, replyOf } from './answer-from-push'

const mockReply = jest.fn()
jest.mock('@/api/chat', () => ({ replyToConversation: (...args: unknown[]) => mockReply(...args) }))
let mockSession: { access_token: string } | null = { access_token: 'token' }
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: mockSession } }) } } }))
jest.mock('@/auth/AuthProvider', () => ({ storedWorkspaceId: async () => 18259 }))
const mockScheduled: { content: { title: string; body: string; data: Record<string, unknown> } }[] = []
const mockDismissed: string[] = []
jest.mock('expo-notifications', () => ({
    setNotificationHandler: jest.fn(),
    clearLastNotificationResponse: jest.fn(),
    dismissNotificationAsync: async (id: string) => void mockDismissed.push(id),
    scheduleNotificationAsync: async (request: (typeof mockScheduled)[number]) => void mockScheduled.push(request),
}))

const approval = { workspaceId: 7, agentId: 'a1', conversationId: 'conv-1', kind: 'approval', toolCallId: 'call-1' }

function response(actionIdentifier: string, data: object, identifier = 'n1', userText?: string) {
    return { actionIdentifier, userText, notification: { request: { identifier, content: { title: 'Closer', data } } } } as never
}

describe('replyOf', () => {
    it('approves or declines the card the push names, and answers it in words', () => {
        expect(replyOf('approve', approval, undefined)).toEqual({ action: 'approve', toolCallId: 'call-1' })
        expect(replyOf('reply', { ...approval, kind: 'question' }, '  the French one ')).toEqual({ action: 'reply', toolCallId: 'call-1', text: 'the French one' })
        expect(replyOf('reply', { agentId: 'a1', conversationId: 'conv-1', kind: 'done' }, 'Now the Spanish one')).toEqual({ action: 'reply', text: 'Now the Spanish one' })
    })

    it('sends nothing for an empty reply, nor an approval without a card', () => {
        expect(replyOf('reply', approval, '   ')).toBeNull()
        expect(replyOf('deny', { agentId: 'a1', conversationId: 'conv-1', kind: 'approval' }, undefined)).toBeNull()
    })
})

describe('answerFromPush', () => {
    beforeEach(() => {
        mockReply.mockReset().mockResolvedValue({ runId: 'run-1' })
        mockScheduled.length = 0
        mockDismissed.length = 0
        mockSession = { access_token: 'token' }
    })

    it('answers in the workspace of the push, replaces the push with a receipt that opens the conversation', async () => {
        await answerFromPush(response('approve', approval))
        expect(mockReply).toHaveBeenCalledWith({ accessToken: 'token', workspaceId: 7 }, 'conv-1', { action: 'approve', toolCallId: 'call-1' })
        expect(mockDismissed).toEqual(['n1'])
        expect(mockScheduled[0].content).toMatchObject({ title: 'Closer', body: 'Approved. Closer is on it.', data: { conversationId: 'conv-1', kind: 'receipt' } })
    })

    it('answers once, however many times the same tap reaches the app', async () => {
        await answerFromPush(response('deny', approval, 'n2'))
        await answerFromPush(response('deny', approval, 'n2'))
        expect(mockReply).toHaveBeenCalledTimes(1)
    })

    it('says why when the hub refuses, a second tap on an answered card above all', async () => {
        mockReply.mockRejectedValue(new Error('This request was already answered.'))
        await answerFromPush(response('approve', approval, 'n3'))
        expect(mockScheduled[0].content.body).toBe('Not sent: This request was already answered.')
    })

    it('asks to sign in again when the phone has no session left', async () => {
        mockSession = null
        await answerFromPush(response('reply', { ...approval, kind: 'question' }, 'n4', 'Yes'))
        expect(mockReply).not.toHaveBeenCalled()
        expect(mockScheduled[0].content.body).toBe('Not sent: Open Rerun to sign in again.')
    })

    it('leaves a tap on the push and Open to the routing', async () => {
        await answerFromPush(response('expo.modules.notifications.actions.DEFAULT', approval, 'n5'))
        await answerFromPush(response('open', approval, 'n6'))
        expect(mockReply).not.toHaveBeenCalled()
        expect(mockScheduled).toEqual([])
    })
})
