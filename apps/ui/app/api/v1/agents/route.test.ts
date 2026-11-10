import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAgentWithSetup = vi.fn()
const startKickoff = vi.fn()
const assertSpaceOwnedBy = vi.fn()
vi.mock('@/app/api/_services/agent-setup.service', () => ({ createAgentWithSetup: (...args: unknown[]) => createAgentWithSetup(...args) }))
vi.mock('@/app/api/_services/kickoff.service', () => ({ startKickoff: (...args: unknown[]) => startKickoff(...args) }))
vi.mock('@/app/api/_services/board-agents.service', () => ({ listBoardAgents: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1', user_metadata: { full_name: 'Ada' } }, workspace: { id: 7 }, role: 'member', boxScope: 'all', supabase: {} }),
    assertSpaceOwnedBy: (...args: unknown[]) => assertSpaceOwnedBy(...args),
}))

const { POST } = await import('./route')

const SPACE = '9b2f0c1e-4c1a-4b8e-9a52-2d5d3f1a7c11'
const segment = { params: Promise.resolve({}) }
const create = (body: object) => POST(new Request('https://app.rerun.build/api/v1/agents', { method: 'POST', body: JSON.stringify(body) }), segment)

describe('POST /api/v1/agents', () => {
    beforeEach(() => {
        createAgentWithSetup.mockReset().mockResolvedValue({ agentId: 'agent-1', active: true, checklist: [] })
        startKickoff.mockReset().mockResolvedValue({ ok: true, sessionId: 'session-1', runId: 'run-1' })
        assertSpaceOwnedBy.mockReset().mockResolvedValue({ workspace_id: 7 })
    })

    it('creates the coworker in the Box of the workspace and sends its description as the first message', async () => {
        const res = await create({ name: ' Scout ', description: 'Find leads in Lyon', spaceId: SPACE })
        expect(await res.json()).toEqual({ agentId: 'agent-1', active: true, sessionId: 'session-1', runId: 'run-1' })
        expect(assertSpaceOwnedBy).toHaveBeenCalledWith(7, SPACE)
        expect(createAgentWithSetup).toHaveBeenCalledWith({ name: 'Scout', description: 'Find leads in Lyon', workspaceId: 7, spaceId: SPACE, actor: { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'member', boxScope: 'all' } })
        expect(startKickoff).toHaveBeenCalledWith('agent-1', { description: 'Find leads in Lyon' }, expect.objectContaining({ id: 'user-1' }))
    })

    it('sends nothing to a coworker the plan leaves switched off, nor to one without a description', async () => {
        createAgentWithSetup.mockResolvedValue({ agentId: 'agent-1', active: false, checklist: [] })
        expect(await (await create({ name: 'Scout', description: 'Find leads', spaceId: SPACE })).json()).toEqual({ agentId: 'agent-1', active: false, sessionId: null, runId: null })
        createAgentWithSetup.mockResolvedValue({ agentId: 'agent-2', active: true, checklist: [] })
        expect(await (await create({ name: 'Scout', spaceId: SPACE })).json()).toEqual({ agentId: 'agent-2', active: true, sessionId: null, runId: null })
        expect(startKickoff).not.toHaveBeenCalled()
    })

    it('still answers with the coworker when its first message could not leave', async () => {
        startKickoff.mockResolvedValue({ ok: false, error: 'Engine error', agentGone: false })
        expect(await (await create({ name: 'Scout', description: 'Find leads', spaceId: SPACE })).json()).toEqual({ agentId: 'agent-1', active: true, sessionId: null, runId: null })
    })

    it('refuses a Box of another workspace and a nameless coworker', async () => {
        const { AuthorizationError } = await import('@/app/api/_auth/ownership')
        assertSpaceOwnedBy.mockRejectedValue(new AuthorizationError('spaceNotFound'))
        expect((await create({ name: 'Scout', spaceId: SPACE })).status).toBe(404)
        expect((await create({ name: '  ', spaceId: SPACE })).status).toBe(400)
        expect(createAgentWithSetup).not.toHaveBeenCalled()
    })

    it('answers 403 to a member who only uses the Box, without sending anything', async () => {
        const { AccessDeniedError } = await import('@/app/api/_auth/access')
        createAgentWithSetup.mockRejectedValue(new AccessDeniedError())
        expect((await create({ name: 'Scout', description: 'Find leads', spaceId: SPACE })).status).toBe(403)
        expect(startKickoff).not.toHaveBeenCalled()
    })
})
