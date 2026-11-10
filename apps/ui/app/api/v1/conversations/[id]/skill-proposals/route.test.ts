import { beforeEach, describe, expect, it, vi } from 'vitest'

const listSkillProposalsAction = vi.fn()
const decideSkillProposalAction = vi.fn()
vi.mock('@/app/api/_actions/skill-proposal.actions', () => ({
    listSkillProposalsAction: (...args: unknown[]) => listSkillProposalsAction(...args),
    decideSkillProposalAction: (...args: unknown[]) => decideSkillProposalAction(...args),
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const route = await import('./route')

const proposal = { id: 'p1', sessionId: 'engine-session', toolCallId: 'call-1', mode: 'create', slug: null, title: 'Deal follow-ups', summary: 'Short drafts.', instructions: ['Keep every follow-up under 90 words.'], status: 'proposed', appliedSlug: null, error: null, createdAt: '2026-10-26T09:00:00.000Z' }
const segment = { params: Promise.resolve({ id: 'session-1' }) }
const request = (method: string, body?: object) => new Request('https://app.rerun.build/api/v1/conversations/session-1/skill-proposals', { method, body: body ? JSON.stringify(body) : undefined })

describe('/api/v1/conversations/:id/skill-proposals', () => {
    beforeEach(() => {
        listSkillProposalsAction.mockReset().mockResolvedValue([proposal])
        decideSkillProposalAction.mockReset().mockResolvedValue({ success: true, proposal: { ...proposal, status: 'accepted' } })
    })

    it('lists the proposals of the conversation', async () => {
        const res = await route.GET(request('GET'), segment)
        expect(await res.json()).toEqual({ proposals: [proposal] })
        expect(listSkillProposalsAction).toHaveBeenCalledWith('session-1')
    })

    it('hands the decision to the same action as the web', async () => {
        const res = await route.POST(request('POST', { proposalId: 'p1', decision: 'accept' }), segment)
        expect(await res.json()).toEqual({ proposal: { ...proposal, status: 'accepted' } })
        expect(decideSkillProposalAction).toHaveBeenCalledWith('session-1', 'p1', 'accept')
    })

    it('says why a decision did not go through', async () => {
        decideSkillProposalAction.mockResolvedValue({ success: false, error: 'This coworker comes from a template: its skills are locked.' })
        const res = await route.POST(request('POST', { proposalId: 'p1', decision: 'accept' }), segment)
        expect(res.status).toBe(503)
        expect(await res.json()).toMatchObject({ error: 'This coworker comes from a template: its skills are locked.' })
    })

    it('answers 403 to a member who only uses the Box, and 404 for a conversation they cannot see', async () => {
        decideSkillProposalAction.mockResolvedValue({ success: false, error: 'Only an admin or a manager of this Box can do this', code: 'boxManagerOnly', denied: 'forbidden' })
        expect((await route.POST(request('POST', { proposalId: 'p1', decision: 'accept' }), segment)).status).toBe(403)
        decideSkillProposalAction.mockResolvedValue({ success: false, error: 'Session not found', code: 'sessionNotFound', denied: 'not_found' })
        expect((await route.POST(request('POST', { proposalId: 'p1', decision: 'accept' }), segment)).status).toBe(404)
    })

    it('refuses a decision it does not know', async () => {
        const res = await route.POST(request('POST', { proposalId: 'p1', decision: 'maybe' }), segment)
        expect(res.status).toBe(400)
    })
})
