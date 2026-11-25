import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthorizationError } from '@/app/api/_auth/ownership'
import { ApiError } from '@/lib/api-error'

const engineChat = vi.fn()
let status = 'awaiting_approval'
let claimed = true
let transcript: { role: string; parts: unknown[] }[] = []

vi.mock('@/app/api/_auth/access', () => ({ actorFromContext: () => ({ kind: 'user', userId: 'me', workspaceId: 7 }), callableEngineAgentIds: async () => undefined }))
vi.mock('@/app/api/_services/me.service', () => ({ messageAuthorOf: () => ({ id: 'me' }) }))
vi.mock('@/app/api/_services/chat.service', () => ({
    getExistingSession: vi.fn(async (id: string) => {
        if (id === 'elsewhere') throw new AuthorizationError('sessionNotFound')
        return { sessionId: id, agentId: 'agent-1', engineSessionId: 'engine-session' }
    }),
    resolveAgentTarget: async () => ({ engineAgentId: 'engine-agent', conn: { baseUrl: 'https://engine.test', apiKey: null } }),
    recordMessageSent: vi.fn(),
    claimWaitingSession: vi.fn(async () => claimed),
    updateSessionStatus: vi.fn(),
}))
vi.mock('@/app/api/_services/conversation.service', () => ({ readSessionTranscript: vi.fn(async () => ({ messages: transcript, updatedAt: null })) }))
// The queue's retries are start-chat's, covered by the tests of /api/chat.
vi.mock('@/lib/chat/start-chat', () => ({ QUEUED_RETRY_DELAYS_MS: [], startChat: (...args: unknown[]) => engineChat(...args) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: async () => ({ data: { status } }) }))

const { replyAs, replyToConversation } = await import('./reply.service')
const { claimWaitingSession, getExistingSession, recordMessageSent, updateSessionStatus } = await import('@/app/api/_services/chat.service')
const { readSessionTranscript } = await import('@/app/api/_services/conversation.service')

const ctx = {} as never
const approvalCard = (toolCallId: string) => [{ role: 'assistant', parts: [{ type: 'tool-request_approval', toolCallId, input: { approvals: [{ action: 'Send 12 emails' }] } }] }]
const started = () => new Response('data: {}\n\n', { headers: { 'x-run-id': 'run-9' } })

async function refusalOf(promise: Promise<unknown>): Promise<ApiError> {
    const err = await promise.catch(error => error)
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
}

describe('replyToConversation', () => {
    beforeEach(() => {
        status = 'awaiting_approval'
        transcript = approvalCard('call-1')
        claimed = true
        vi.mocked(updateSessionStatus).mockClear()
        engineChat.mockReset().mockImplementation(async () => started())
        vi.mocked(recordMessageSent).mockClear()
    })

    it('approves the card it names, starts the run and lets the stream go', async () => {
        await expect(replyToConversation(ctx, 'conv-1', { action: 'approve', toolCallId: 'call-1' })).resolves.toEqual({ runId: 'run-9' })
        const [, agentId, params] = engineChat.mock.calls[0]
        expect(agentId).toBe('engine-agent')
        expect(params).toMatchObject({ sessionId: 'engine-session', author: { id: 'me' } })
        expect(params.message).toContain('1. **APPROVED** — Send 12 emails')
        expect(recordMessageSent).toHaveBeenCalledWith('conv-1', expect.objectContaining({ userId: 'me' }), params.message)
    })

    it('refuses a card that is no longer the one waiting, on a second tap or once answered in the app', async () => {
        expect((await refusalOf(replyToConversation(ctx, 'conv-1', { action: 'approve', toolCallId: 'call-0' }))).status).toBe(409)
        status = 'working'
        expect((await refusalOf(replyToConversation(ctx, 'conv-1', { action: 'deny', toolCallId: 'call-1' }))).code).toBe('requestAlreadyAnswered')
        expect(engineChat).not.toHaveBeenCalled()
    })

    it('lets one of two answers sent at the same moment through, and takes the card before the engine hears of it', async () => {
        await replyToConversation(ctx, 'conv-1', { action: 'approve', toolCallId: 'call-1' })
        expect(claimWaitingSession).toHaveBeenCalledWith('conv-1', 'awaiting_approval')
        engineChat.mockClear()
        claimed = false
        expect((await refusalOf(replyToConversation(ctx, 'conv-1', { action: 'approve', toolCallId: 'call-1' }))).code).toBe('requestAlreadyAnswered')
        expect(engineChat).not.toHaveBeenCalled()
    })

    it('gives the card back when the engine did not take the answer', async () => {
        engineChat.mockImplementation(async () => new Response('down', { status: 502 }))
        expect((await refusalOf(replyToConversation(ctx, 'conv-1', { action: 'approve', toolCallId: 'call-1' }))).status).toBe(502)
        expect(updateSessionStatus).toHaveBeenCalledWith('conv-1', 'awaiting_approval')
        expect(recordMessageSent).not.toHaveBeenCalled()
    })

    it('sends a reply to a finished run as a plain message', async () => {
        status = 'idle'
        await replyToConversation(ctx, 'conv-1', { action: 'reply', text: 'Now the Spanish one' })
        expect(engineChat.mock.calls[0][2].message).toBe('Now the Spanish one')
    })

    it('says the coworker is still busy once the queue gave up, without recording anything', async () => {
        engineChat.mockImplementation(async () => Response.json({ runId: 'run-1' }, { status: 409 }))
        expect((await refusalOf(replyToConversation(ctx, 'conv-1', { action: 'reply', text: 'Thanks' }))).code).toBe('coworkerStillWorking')
        expect(recordMessageSent).not.toHaveBeenCalled()
    })

    it('reads a conversation of another workspace as missing', async () => {
        await expect(replyToConversation(ctx, 'elsewhere', { action: 'approve', toolCallId: 'call-1' })).rejects.toBeInstanceOf(AuthorizationError)
    })

    it('answers in the name of the member a Chief of Staff turn speaks for, reading the card as that member', async () => {
        const member = { kind: 'user', userId: 'u-2', workspaceId: 7, role: 'member', boxScope: 'all' } as const
        await replyAs(member, { id: 'u-2', name: 'Ada', via: 'foreman' }, 'conv-1', { action: 'approve', toolCallId: 'call-1' })
        expect(getExistingSession).toHaveBeenCalledWith('conv-1', member)
        expect(readSessionTranscript).toHaveBeenCalledWith('conv-1', member)
        expect(engineChat.mock.calls[0][2]).toMatchObject({ author: { id: 'u-2', name: 'Ada', via: 'foreman' } })
        expect(recordMessageSent).toHaveBeenCalledWith('conv-1', member, expect.stringContaining('**APPROVED**'))
    })
})
