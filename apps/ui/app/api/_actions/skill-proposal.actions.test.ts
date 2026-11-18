import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getSessionEngineContext: vi.fn(),
    getAgentChatTarget: vi.fn(),
    clearSkillProposalAttention: vi.fn(async () => {}),
    requireWorkspaceContext: vi.fn(),
    foremanSessionEngineContext: vi.fn(),
    listSkillProposals: vi.fn(),
    decideSkillProposal: vi.fn(),
}))

vi.mock('@/app/api/_services/chat.service', () => ({ getSessionEngineContext: mocks.getSessionEngineContext, getAgentChatTarget: mocks.getAgentChatTarget, clearSkillProposalAttention: mocks.clearSkillProposalAttention }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()), requireWorkspaceContext: mocks.requireWorkspaceContext }))
vi.mock('@/lib/foreman/conversation', () => ({ foremanSessionEngineContext: mocks.foremanSessionEngineContext }))
vi.mock('@/lib/engine/client', () => ({ listSkillProposals: mocks.listSkillProposals, decideSkillProposal: mocks.decideSkillProposal }))

const { AuthorizationError } = await import('@/app/api/_auth/ownership')
const { AccessDeniedError } = await import('@/app/api/_auth/access')
const { decideSkillProposalAction, listSkillProposalsAction } = await import('./skill-proposal.actions')

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const proposal = { id: 'p1', status: 'accepted' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionEngineContext.mockRejectedValue(new AuthorizationError('sessionNotFound'))
    mocks.requireWorkspaceContext.mockResolvedValue({ workspace: { id: 7 }, userId: 'u1' })
    mocks.foremanSessionEngineContext.mockResolvedValue({ conn, engineSessionId: 'engine-1' })
    mocks.listSkillProposals.mockResolvedValue([proposal])
    mocks.decideSkillProposal.mockResolvedValue(proposal)
    mocks.getAgentChatTarget.mockResolvedValue({ conn, engineAgentId: 'foreman' })
})

describe('the skill proposals of a conversation with the Chief of Staff', () => {
    it("reads them from the caller's own conversation", async () => {
        expect(await listSkillProposalsAction('conversation-1')).toEqual([proposal])
        expect(mocks.foremanSessionEngineContext).toHaveBeenCalledWith({ workspace: { id: 7 }, userId: 'u1' }, 'conversation-1')
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(conn, 'foreman', 'engine-1')
    })

    it("reads nothing from a conversation that is not the caller's", async () => {
        mocks.foremanSessionEngineContext.mockResolvedValue(null)
        expect(await listSkillProposalsAction('conversation-2')).toEqual([])
        expect(mocks.listSkillProposals).not.toHaveBeenCalled()
    })

    it('lets a workspace admin decide one, touching no coworker session', async () => {
        expect(await decideSkillProposalAction('conversation-1', 'p1', 'accept')).toEqual({ success: true, proposal })
        expect(mocks.getAgentChatTarget).toHaveBeenCalledWith('foreman', 'manage')
        expect(mocks.decideSkillProposal).toHaveBeenCalledWith(conn, 'foreman', 'p1', 'accept')
        expect(mocks.clearSkillProposalAttention).not.toHaveBeenCalled()
    })

    it('refuses a member who cannot change what it keeps', async () => {
        mocks.getAgentChatTarget.mockRejectedValue(new AccessDeniedError())
        expect(await decideSkillProposalAction('conversation-1', 'p1', 'accept')).toMatchObject({ success: false, denied: 'forbidden' })
        expect(mocks.decideSkillProposal).not.toHaveBeenCalled()
    })

    it("still reads a coworker's session first", async () => {
        mocks.getSessionEngineContext.mockResolvedValue({ agentId: 'agent-1', conn, engineAgentId: 'e1', engineSessionId: 's1' })
        await listSkillProposalsAction('session-1')
        expect(mocks.listSkillProposals).toHaveBeenCalledWith(conn, 'e1', 's1')
        expect(mocks.foremanSessionEngineContext).not.toHaveBeenCalled()
    })
})
