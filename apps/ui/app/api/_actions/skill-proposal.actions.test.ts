import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getSessionEngineContext: vi.fn(),
    resolveAgentTarget: vi.fn(),
    decideCoworkerSkillProposal: vi.fn(),
    clearForemanSkillProposalAttention: vi.fn(async () => {}),
    listSkillProposals: vi.fn(),
    decideSkillProposal: vi.fn(),
}))

vi.mock('@/app/api/_services/chat.service', () => ({ getSessionEngineContext: mocks.getSessionEngineContext, resolveAgentTarget: mocks.resolveAgentTarget, decideCoworkerSkillProposal: mocks.decideCoworkerSkillProposal }))
vi.mock('@/lib/foreman/conversation', () => ({ clearForemanSkillProposalAttention: mocks.clearForemanSkillProposalAttention }))
vi.mock('@/lib/engine/client', () => ({ listSkillProposals: mocks.listSkillProposals, decideSkillProposal: mocks.decideSkillProposal }))

const { AuthorizationError } = await import('@/app/api/_auth/ownership')
const { AccessDeniedError } = await import('@/app/api/_auth/access')
const { decideSkillProposalAction, listSkillProposalsAction } = await import('./skill-proposal.actions')

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const proposal = { id: 'p1', status: 'accepted' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionEngineContext.mockResolvedValue({ agentId: 'cos-row', conn, engineAgentId: 'foreman', engineSessionId: 'engine-1' })
    mocks.listSkillProposals.mockResolvedValue([proposal])
    mocks.decideSkillProposal.mockResolvedValue(proposal)
    mocks.resolveAgentTarget.mockResolvedValue({ conn, engineAgentId: 'foreman' })
})

describe('the skill proposals of a conversation with the Chief of Staff', () => {
    it("reads them from the caller's own conversation", async () => {
        expect(await listSkillProposalsAction('conversation-1')).toEqual([proposal])
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(conn, 'foreman', 'engine-1')
    })

    it("reads nothing from a conversation that is not the caller's", async () => {
        mocks.getSessionEngineContext.mockRejectedValue(new AuthorizationError('sessionNotFound'))
        expect(await listSkillProposalsAction('conversation-2')).toEqual([])
        expect(mocks.listSkillProposals).not.toHaveBeenCalled()
    })

    it('lets a workspace admin decide one, touching no coworker session', async () => {
        expect(await decideSkillProposalAction('conversation-1', 'p1', 'accept')).toEqual({ success: true, proposal })
        expect(mocks.resolveAgentTarget).toHaveBeenCalledWith('cos-row', 'manage')
        expect(mocks.decideSkillProposal).toHaveBeenCalledWith(conn, 'foreman', 'p1', 'accept', undefined)
        expect(mocks.decideCoworkerSkillProposal).not.toHaveBeenCalled()
    })

    it('stops its thread from waiting once the proposal is decided, without failing the decision when that cannot be done', async () => {
        await decideSkillProposalAction('conversation-1', 'p1', 'dismiss')
        expect(mocks.clearForemanSkillProposalAttention).toHaveBeenCalledWith(conn, 'conversation-1', 'engine-1')

        mocks.clearForemanSkillProposalAttention.mockRejectedValueOnce(new Error('engine away'))
        expect(await decideSkillProposalAction('conversation-1', 'p1', 'dismiss')).toEqual({ success: true, proposal })
    })

    it('refuses a member who cannot change what it keeps', async () => {
        mocks.resolveAgentTarget.mockRejectedValue(new AccessDeniedError())
        expect(await decideSkillProposalAction('conversation-1', 'p1', 'accept')).toMatchObject({ success: false, denied: 'forbidden' })
        expect(mocks.decideSkillProposal).not.toHaveBeenCalled()
    })

    it("takes a coworker's session the coworker's way", async () => {
        mocks.getSessionEngineContext.mockResolvedValue({ agentId: 'agent-1', conn, engineAgentId: 'e1', engineSessionId: 's1' })
        await listSkillProposalsAction('session-1')
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(conn, 'e1', 's1')
        mocks.decideCoworkerSkillProposal.mockResolvedValue(proposal)
        expect(await decideSkillProposalAction('session-1', 'p1', 'accept')).toEqual({ success: true, proposal })
        expect(mocks.decideCoworkerSkillProposal).toHaveBeenCalledWith({ agentId: 'agent-1', conn, engineAgentId: 'e1', engineSessionId: 's1' }, 'session-1', 'p1', 'accept', undefined, undefined)
        expect(mocks.clearForemanSkillProposalAttention).not.toHaveBeenCalled()
    })

    it('hands the engine the model the conversation is set to', async () => {
        const pick = { connectionId: 'codex-1', model: 'gpt-6-sol' }
        await decideSkillProposalAction('conversation-1', 'p1', 'accept', pick)
        expect(mocks.decideSkillProposal).toHaveBeenCalledWith(conn, 'foreman', 'p1', 'accept', pick)

        mocks.getSessionEngineContext.mockResolvedValue({ agentId: 'agent-1', conn, engineAgentId: 'e1', engineSessionId: 's1' })
        mocks.decideCoworkerSkillProposal.mockResolvedValue(proposal)
        await decideSkillProposalAction('session-1', 'p1', 'accept', pick)
        expect(mocks.decideCoworkerSkillProposal).toHaveBeenCalledWith({ agentId: 'agent-1', conn, engineAgentId: 'e1', engineSessionId: 's1' }, 'session-1', 'p1', 'accept', undefined, pick)
    })
})
