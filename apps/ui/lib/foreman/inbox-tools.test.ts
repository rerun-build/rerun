import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api-error'
import type { PendingCard } from '@/app/api/_services/conversation.service'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import type { SkillProposal } from '@rerun/contracts'

const mocks = vi.hoisted(() => ({
    listPendingCards: vi.fn(),
    readPendingRequest: vi.fn(),
    replyAs: vi.fn(),
    getSessionEngineContext: vi.fn(),
    decideCoworkerSkillProposal: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/conversation.service', () => ({ listPendingCards: mocks.listPendingCards, readPendingRequest: mocks.readPendingRequest }))
vi.mock('@/app/api/_services/reply.service', () => ({ replyAs: mocks.replyAs }))
vi.mock('@/app/api/_services/chat.service', () => ({ getSessionEngineContext: mocks.getSessionEngineContext, decideCoworkerSkillProposal: mocks.decideCoworkerSkillProposal }))
vi.mock('@/app/api/_services/me.service', () => ({ messageAuthorOf: ({ userId }: { userId: string }) => ({ id: userId, name: 'Ada Lovelace' }) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id } } }) } } }) }))

const { dispatchInboxTool } = await import('./inbox-tools')

const member = { kind: 'user', userId: 'u-1', workspaceId: 7, role: 'member', boxScope: 'all' } as const
const checkin = { kind: 'workspace', workspaceId: 7 } as const
const relayedAuthor = { id: 'u-1', name: 'Ada Lovelace', via: 'foreman' }

const peekOf = (pending: PendingRequestPeek['pending'], proposal: PendingRequestPeek['proposal'] = null): PendingRequestPeek => ({ pending, ask: 'May I?', before: null, proposal })
const question = (questions: unknown[]) => peekOf({ kind: 'question', toolCallId: 'call-q', input: { questions } })
const approval = peekOf({ kind: 'approval', toolCallId: 'call-a', input: { approvals: [{ action: 'Send 12 emails' }] } })
const spend = peekOf({ kind: 'spend', toolCallId: 'call-s', input: { purpose: 'Find 40 emails' } })
const proposal: SkillProposal = { id: 'p-1', sessionId: 'engine-s', toolCallId: 'call-p', mode: 'create', slug: null, title: 'Weekly digest', summary: 'Send it on Mondays', instructions: [], status: 'proposed', appliedSlug: null, error: null, createdAt: '2026-11-20' }

const card = (sessionId: string, peek: PendingRequestPeek): PendingCard => ({ sessionId, agentId: `agent-${sessionId}`, agentName: 'Writer', title: 'Newsletter', status: 'awaiting_question', updatedAt: '2026-11-20T10:00:00Z', peek })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.replyAs.mockResolvedValue({ runId: 'run-1' })
})

describe('list_pending_cards', () => {
    it('reads each card with what it asks, and says which ones only the user can answer and why', async () => {
        mocks.listPendingCards.mockResolvedValue([
            card('s1', question([{ question: 'Which tone?', options: ['Formal', 'Casual'] }])),
            card('s2', approval),
            card('s3', peekOf({ kind: 'secret', toolCallId: 'call-k', input: { secrets: [{ key: 'HUBSPOT_TOKEN' }] } })),
            card('s4', peekOf(null, proposal)),
        ])

        const { cards } = (await dispatchInboxTool(member, 'list_pending_cards', {})) as { cards: Record<string, unknown>[] }

        expect(mocks.listPendingCards).toHaveBeenCalledWith(member)
        expect(cards[0]).toMatchObject({ sessionId: 's1', coworker: 'Writer', kind: 'question', toolCallId: 'call-q', ask: 'May I?', questions: [{ question: 'Which tone?', options: ['Formal', 'Casual'] }], answeredBy: 'answer_card' })
        expect(cards[1]).toMatchObject({ kind: 'approval', approvals: [{ action: 'Send 12 emails' }], answeredBy: 'answer_card' })
        expect(cards[2]).toMatchObject({ kind: 'secret', answeredBy: 'user', why: expect.stringMatching(/credential/) })
        expect(cards[3]).toMatchObject({ kind: 'skill_proposal', proposal: { proposalId: 'p-1', title: 'Weekly digest' }, answeredBy: 'answer_card' })
    })

    it('says so when nothing waits', async () => {
        mocks.listPendingCards.mockResolvedValue([])
        expect(await dispatchInboxTool(checkin, 'list_pending_cards', {})).toEqual({ cards: [], note: 'Nothing waits on the user.' })
    })
})

describe('answer_card', () => {
    it('answers a question in the name of the member, signed as sent by the Chief of Staff', async () => {
        mocks.readPendingRequest.mockResolvedValue(question([{ question: 'Which tone?', options: ['Formal', 'Casual'] }]))

        const result = await dispatchInboxTool(member, 'answer_card', { sessionId: 's1', toolCallId: 'call-q', action: 'reply', text: 'Casual' })

        expect(mocks.readPendingRequest).toHaveBeenCalledWith('s1', member)
        expect(mocks.replyAs).toHaveBeenCalledWith(member, relayedAuthor, 's1', { action: 'reply', toolCallId: 'call-q', text: 'Casual' })
        expect(result).toMatchObject({ sessionId: 's1', answered: 'question', answer: 'Casual', runId: 'run-1' })
    })

    it('words one answer per question on a card that asks several', async () => {
        mocks.readPendingRequest.mockResolvedValue(question([{ question: 'Which tone?' }, { question: 'How long?' }]))

        await dispatchInboxTool(member, 'answer_card', { sessionId: 's1', toolCallId: 'call-q', action: 'reply', answers: [{ question: 'How long?', answer: '300 words' }, { question: 'Which tone?', answer: 'Casual' }] })

        expect(mocks.replyAs.mock.calls[0][3].text).toBe('Here are my answers:\n\n**Which tone?**\nCasual\n\n**How long?**\n300 words')
    })

    it('sends the bare answer of a one-question card given in answers, worded once by the reply', async () => {
        mocks.readPendingRequest.mockResolvedValue(question([{ question: 'Which tone?', options: ['Formal', 'Casual'] }]))

        await dispatchInboxTool(member, 'answer_card', { sessionId: 's1', toolCallId: 'call-q', action: 'reply', answers: [{ question: 'Which tone?', answer: ' Casual ' }] })

        expect(mocks.replyAs.mock.calls[0][3]).toEqual({ action: 'reply', toolCallId: 'call-q', text: 'Casual' })
    })

    it.each([
        ['a question left without an answer', [{ question: 'Which tone?', answer: 'Casual' }]],
        ['a question copied with another wording', [{ question: 'Which tone?', answer: 'Casual' }, { question: 'How long should it be?', answer: '300 words' }]],
    ])('refuses %s instead of sending it as skipped', async (_case, answers) => {
        mocks.readPendingRequest.mockResolvedValue(question([{ question: 'Which tone?' }, { question: 'How long?' }]))

        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's1', toolCallId: 'call-q', action: 'reply', answers })).rejects.toThrow(/"How long\?"/)
        expect(mocks.replyAs).not.toHaveBeenCalled()
    })

    it('needs the card it read, never answering whichever one waits now', async () => {
        mocks.readPendingRequest.mockResolvedValue(approval)
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's2', action: 'approve' })).rejects.toThrow(/toolCallId/)
        expect(mocks.replyAs).not.toHaveBeenCalled()
    })

    it('approves or declines an approval', async () => {
        mocks.readPendingRequest.mockResolvedValue(approval)
        await dispatchInboxTool(member, 'answer_card', { sessionId: 's2', toolCallId: 'call-a', action: 'approve' })
        await dispatchInboxTool(member, 'answer_card', { sessionId: 's2', toolCallId: 'call-a', action: 'decline' })
        expect(mocks.replyAs.mock.calls.map(call => call[3])).toEqual([
            { action: 'approve', toolCallId: 'call-a' },
            { action: 'deny', toolCallId: 'call-a' },
        ])
    })

    it("approves a spend only once the user said yes, and declines one without asking", async () => {
        mocks.readPendingRequest.mockResolvedValue(spend)

        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's3', toolCallId: 'call-s', action: 'approve' })).rejects.toThrow(/request_approval/)
        expect(mocks.replyAs).not.toHaveBeenCalled()

        await dispatchInboxTool(member, 'answer_card', { sessionId: 's3', toolCallId: 'call-s', action: 'approve', userApproved: true })
        await dispatchInboxTool(member, 'answer_card', { sessionId: 's3', toolCallId: 'call-s', action: 'decline' })
        expect(mocks.replyAs.mock.calls.map(call => call[3].action)).toEqual(['approve', 'deny'])
    })

    it.each(['secret', 'service', 'mcp', 'takeover', 'computer'] as const)('leaves a %s card to the user', async kind => {
        mocks.readPendingRequest.mockResolvedValue(peekOf({ kind, toolCallId: 'call-x', input: {} }))
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's1', toolCallId: 'call-x', action: 'approve' })).rejects.toThrow(/user/)
        expect(mocks.replyAs).not.toHaveBeenCalled()
    })

    it('refuses a card answered meanwhile, read again or refused by the hub', async () => {
        mocks.readPendingRequest.mockResolvedValue(approval)
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's2', toolCallId: 'call-old', action: 'approve' })).rejects.toThrow(/list_pending_cards/)

        mocks.replyAs.mockRejectedValue(new ApiError(409, { error: 'Already answered', code: 'requestAlreadyAnswered' }))
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's2', toolCallId: 'call-a', action: 'approve' })).rejects.toThrow(/list_pending_cards/)
    })

    it('answers nothing for a turn with no member behind it', async () => {
        await expect(dispatchInboxTool(checkin, 'answer_card', { sessionId: 's2', action: 'approve' })).rejects.toThrow(/no.*behind it|none behind it/)
        expect(mocks.readPendingRequest).not.toHaveBeenCalled()
    })

    it('decides a skill proposal, refusing one that is no longer the one waiting', async () => {
        const target = { agentId: 'agent-s4', conn: {}, engineAgentId: 'engine-a', engineSessionId: 'engine-s' }
        mocks.readPendingRequest.mockResolvedValue(peekOf(null, proposal))
        mocks.getSessionEngineContext.mockResolvedValue(target)
        mocks.decideCoworkerSkillProposal.mockResolvedValue({ ...proposal, status: 'accepted' })

        const result = await dispatchInboxTool(member, 'answer_card', { sessionId: 's4', action: 'approve', proposalId: 'p-1' })

        expect(mocks.decideCoworkerSkillProposal).toHaveBeenCalledWith(target, 's4', 'p-1', 'accept', member)
        expect(result).toMatchObject({ answered: 'skill_proposal', decision: 'remembered' })
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's4', action: 'approve', proposalId: 'p-0' })).rejects.toThrow(/list_pending_cards/)
        await expect(dispatchInboxTool(member, 'answer_card', { sessionId: 's4', action: 'approve' })).rejects.toThrow(/proposalId/)
    })
})
