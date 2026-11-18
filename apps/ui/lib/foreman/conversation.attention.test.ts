import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ update: vi.fn(), listSkillProposals: vi.fn(), getSessionMessages: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ update: mocks.update }) }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: vi.fn(), selectMany: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ FIRST_MESSAGE_MAX_CHARS: 200, GENERAL_SESSION_TITLE: 'General' }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn() }))
vi.mock('@/lib/chat/engine-history', () => ({ transformEngineMessages: (messages: unknown[]) => messages }))
vi.mock('@/lib/engine/client', () => ({ listSkillProposals: mocks.listSkillProposals, getSessionMessages: mocks.getSessionMessages, cancelRun: vi.fn(), listRuns: vi.fn() }))

const { clearForemanSkillProposalAttention } = await import('./conversation')

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const proposal = (status: string) => ({ id: `p-${status}`, status, createdAt: '2026-11-18T09:00:00.000Z' })
const answered = [{ role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }]
const stoppedOnApproval = [{ role: 'assistant', parts: [{ type: 'tool-request_approval', toolCallId: 'call-1', input: { action: 'Delete the table', details: 'orders' } }] }]

let filters: Array<[string, unknown]>

beforeEach(() => {
    vi.clearAllMocks()
    filters = []
    const chain = {
        eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return chain
        },
        then: (resolve: (result: { error: null }) => void) => resolve({ error: null }),
    }
    mocks.update.mockReturnValue(chain)
    mocks.listSkillProposals.mockResolvedValue([proposal('accepted')])
    mocks.getSessionMessages.mockResolvedValue(answered)
})

describe('clearForemanSkillProposalAttention', () => {
    it('stops the thread from waiting once its proposal is decided', async () => {
        await clearForemanSkillProposalAttention(conn, 'conversation-1', 'engine-1')
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(conn, 'foreman', 'engine-1')
        expect(mocks.update).toHaveBeenCalledWith({ status: 'idle' })
        expect(filters).toEqual([
            ['id', 'conversation-1'],
            ['status', 'awaiting_approval'],
        ])
    })

    it.each(['proposed', 'failed'])('keeps it waiting while another proposal is %s', async status => {
        mocks.listSkillProposals.mockResolvedValue([proposal('dismissed'), proposal(status)])
        await clearForemanSkillProposalAttention(conn, 'conversation-1', 'engine-1')
        expect(mocks.update).not.toHaveBeenCalled()
    })

    // A run stopped on request_approval leaves the same status, and that one is still owed an answer.
    it('keeps it waiting on a request the run stopped on', async () => {
        mocks.getSessionMessages.mockResolvedValue(stoppedOnApproval)
        await clearForemanSkillProposalAttention(conn, 'conversation-1', 'engine-1')
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it('reads nothing for a conversation the engine never opened', async () => {
        await clearForemanSkillProposalAttention(conn, 'conversation-1', null)
        expect(mocks.listSkillProposals).not.toHaveBeenCalled()
        expect(mocks.update).not.toHaveBeenCalled()
    })
})
