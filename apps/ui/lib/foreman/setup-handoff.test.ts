import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureSessionRow = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => 'session-row')
const resolveAgentTarget = vi.fn(async () => ({ conn: {}, engineAgentId: 'engine-1' }))
const engineChat = vi.fn()
const engineGetAgent = vi.fn()

const selectMany = vi.fn<(...args: unknown[]) => Promise<{ data: { id: string; name?: string; disabled_at: string | null }[] }>>(async () => ({ data: [] }))
const callableEngineAgentIds = vi.fn<(...args: unknown[]) => Promise<string[] | undefined>>(async () => undefined)

vi.mock('@/app/api/_auth/access', () => ({ workspaceActor: (workspaceId: number) => ({ kind: 'workspace', workspaceId }), callableEngineAgentIds }))
vi.mock('@/app/api/_services/chat.service', () => ({ ensureSessionRow, resolveAgentTarget }))
vi.mock('@/lib/engine/client', () => ({ chat: engineChat, getAgent: engineGetAgent }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany }))

const { startAgentSetup } = await import('./setup-handoff')

const BASE = { workspace: { id: 7 } }
const CTX = BASE as never

function accepted(sessionId: string | null, runId: string | null = 'engine-run-1') {
    const headers = new Headers()
    if (sessionId) headers.set('x-session-id', sessionId)
    if (runId) headers.set('x-run-id', runId)
    return { ok: true, headers, body: null }
}

// An agent with nothing pending, so the message the foreman wrote is the one that goes through.
function bespokeAgent() {
    return { config: { setup: { required: false, completedAt: null } }, install: '' }
}

describe('startAgentSetup', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureSessionRow.mockResolvedValue('session-row')
        engineGetAgent.mockResolvedValue(bespokeAgent())
        selectMany.mockResolvedValue({ data: [] })
        callableEngineAgentIds.mockResolvedValue(undefined)
    })

    // The foreman of a member hands over with that member's access: a coworker in a Box closed to
    // them is refused, and the run it starts calls only the coworkers they reach.
    it('starts the setup as the member behind the turn, and narrows what the run can call', async () => {
        const member = { kind: 'user', userId: 'user-2', workspaceId: 7, role: 'member', boxScope: 'assigned' }
        callableEngineAgentIds.mockResolvedValue(['engine-1'])
        engineChat.mockResolvedValue(accepted('engine-session-1'))

        await startAgentSetup({ ...BASE, actor: member } as never, { agents: [{ agentId: 'agent-1', message: 'Triage the inbox' }] })

        expect(resolveAgentTarget).toHaveBeenCalledWith('agent-1', 'use', member)
        expect(callableEngineAgentIds).toHaveBeenCalledWith(member)
        expect(engineChat.mock.calls[0][2]).toMatchObject({ callableAgentIds: ['engine-1'] })
    })

    it('refuses a coworker the member cannot reach, beside the ones that started', async () => {
        resolveAgentTarget.mockRejectedValueOnce(new Error('Coworker not found'))

        const result = (await startAgentSetup({ ...BASE, actor: { kind: 'user', userId: 'user-2', workspaceId: 7, role: 'member', boxScope: 'assigned' } } as never, { agents: [{ agentId: 'agent-9', message: 'Go' }] })) as { agents: { started: boolean; error?: string }[] }

        expect(result.agents[0]).toMatchObject({ started: false, error: 'Coworker not found' })
        expect(engineChat).not.toHaveBeenCalled()
    })

    // The whole point of the hand-over: /chat announces no session, so without this write the run
    // happens on the engine and the agent's chat stays on an empty "New conversation".
    it('mirrors the session the engine opened', async () => {
        engineChat.mockResolvedValue(accepted('engine-session-1'))

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-1', message: 'Triage the inbox' }] })) as { agents: Record<string, unknown>[] }

        expect(result.agents[0].started).toBe(true)
        expect(ensureSessionRow).toHaveBeenCalledWith('agent-1', 'engine-session-1', 'Triage the inbox', { source: 'api', status: 'working' })
        expect(result.agents[0]).toMatchObject({ conversationId: 'session-row', runId: 'engine-run-1' })
    })

    // The engine id opens nothing: the panel addresses a conversation by its row. Answering with
    // both would hand the foreman two ids for one conversation, and the wrong one is the current
    // bug, an empty chat opened beside the run.
    it('answers with the row id rather than the engine one', async () => {
        engineChat.mockResolvedValue(accepted('engine-session-1'))

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-1', message: 'Triage the inbox' }] })) as { agents: Record<string, unknown>[]; next: string }

        expect(result.agents[0]).not.toHaveProperty('sessionId')
        expect(result.next).toContain('conversationId')
    })

    // The message is already on its way when the copy fails, so the run did start: the only thing
    // missing is somewhere to land the user.
    it('reports an agent whose session row could not be written as started, with no conversation', async () => {
        engineChat.mockResolvedValue(accepted('engine-session-5'))
        ensureSessionRow.mockResolvedValueOnce(null)

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-5', message: 'Go' }] })) as { agents: { started: boolean; conversationId?: string | null }[] }

        expect(result.agents[0].started).toBe(true)
        expect(result.agents[0].conversationId).toBeNull()
    })

    // The install its author wrote replaces the foreman's message. It goes out wrapped so the chat
    // draws a setup block, and the conversation is named after the setup rather than the guide.
    it('sends the install an agent plays instead of the written message', async () => {
        selectMany.mockResolvedValue({ data: [{ id: 'agent-2', name: 'Closer', disabled_at: null }] })
        engineGetAgent.mockResolvedValue({ config: { name: 'closer', setup: { required: true, completedAt: null } }, install: 'Run your own setup' })
        engineChat.mockResolvedValue(accepted('engine-session-2'))

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-2', message: 'Triage the inbox' }] })) as { agents: { ranItsOwnInstall?: boolean }[] }

        expect(result.agents[0].ranItsOwnInstall).toBe(true)
        expect(engineChat).toHaveBeenCalledWith({}, 'engine-1', { message: '<agent_install agent="Closer">\nRun your own setup\n</agent_install>', source: 'api', install: true, teamRequests: expect.any(Boolean) })
        expect(ensureSessionRow).toHaveBeenCalledWith('agent-2', 'engine-session-2', 'Install Closer', { source: 'api', status: 'working' })
    })

    // The install already runs in a conversation of its own: the handoff lands the user there.
    it('opens the install already under way instead of starting a second one', async () => {
        selectMany.mockResolvedValue({ data: [{ id: 'agent-2', name: 'Closer', disabled_at: null }] })
        engineGetAgent.mockResolvedValue({ config: { name: 'closer', setup: { required: true, completedAt: null } }, install: 'Run your own setup' })
        engineChat.mockResolvedValue({ ok: false, status: 409, text: async () => JSON.stringify({ code: 'install_in_flight', sessionId: 'engine-install' }), headers: new Headers(), body: null })
        ensureSessionRow.mockResolvedValueOnce('row-install')

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-2', message: 'Triage the inbox' }] })) as { agents: { started: boolean; conversationId?: string | null; runId?: string | null }[] }

        expect(result.agents[0]).toMatchObject({ started: true, conversationId: 'row-install', runId: null })
        expect(ensureSessionRow).toHaveBeenCalledWith('agent-2', 'engine-install', 'Install Closer', { source: 'api' })
    })

    // Reported beside the ones that started, never thrown: the rest of the team is already working.
    it('reports an agent that could not be reached without mirroring anything', async () => {
        engineChat.mockResolvedValue({ ok: false, status: 409, text: async () => 'run_in_flight', headers: new Headers(), body: null })

        const result = (await startAgentSetup(CTX, { agents: [{ agentId: 'agent-3', message: 'Go' }] })) as { agents: { started: boolean; error?: string }[]; next: string }

        expect(result.agents[0].started).toBe(false)
        expect(result.next).toContain('0 agent(s)')
        expect(ensureSessionRow).not.toHaveBeenCalled()
    })

    // Two entries for one agent would start two runs on it and ask the user the same thing twice.
    it('starts one setup per agent however many times it is listed', async () => {
        engineChat.mockResolvedValue(accepted('engine-session-4'))

        await startAgentSetup(CTX, {
            agents: [
                { agentId: 'agent-4', message: 'First' },
                { agentId: 'agent-4', message: 'Second' },
            ],
        })

        expect(engineChat).toHaveBeenCalledTimes(1)
        expect(ensureSessionRow).toHaveBeenCalledTimes(1)
    })

    // The plan caps how many agents run at once, not how many exist, so a team built past that cap
    // ends on agents that cannot be addressed at all. Sending them to the engine anyway turns an
    // upsell into "half your team could not be reached" on the last screen of the onboarding.
    it('never reaches for an agent the plan has no slot for', async () => {
        engineChat.mockResolvedValue(accepted('engine-session-1'))
        selectMany.mockResolvedValue({ data: [{ id: 'agent-1', disabled_at: null }, { id: 'agent-2', disabled_at: '2026-09-22T10:00:00Z' }] })

        const result = (await startAgentSetup(CTX, {
            agents: [
                { agentId: 'agent-1', message: 'Triage the inbox' },
                { agentId: 'agent-2', message: 'Write the weekly post' },
            ],
        })) as { agents: Record<string, unknown>[]; next: string }

        expect(result.agents[0]).toMatchObject({ agentId: 'agent-1', started: true })
        expect(result.agents[1]).toMatchObject({ agentId: 'agent-2', started: false, inactive: true })
        expect(result.agents[1].error).toBeUndefined()

        // The engine is only ever asked about the one that can actually work.
        expect(resolveAgentTarget).toHaveBeenCalledTimes(1)
        expect(resolveAgentTarget).toHaveBeenCalledWith('agent-1', 'use', { kind: 'workspace', workspaceId: 7 })

        expect(result.next).toContain('1 agent(s) are working')
        expect(result.next).toContain('1 are built but have no free slot')
        expect(result.next).not.toContain('could not be reached')
    })

    // A real breakage and a missing slot both come back with started false. Counting them together
    // would report the upsell as an outage, which is the exact sentence this split exists to avoid.
    it('keeps an unreachable agent apart from one waiting on a slot', async () => {
        selectMany.mockResolvedValue({ data: [{ id: 'agent-1', disabled_at: null }, { id: 'agent-2', disabled_at: '2026-09-22T10:00:00Z' }] })
        engineChat.mockRejectedValue(new Error('engine down'))

        const result = (await startAgentSetup(CTX, {
            agents: [
                { agentId: 'agent-1', message: 'Triage the inbox' },
                { agentId: 'agent-2', message: 'Write the weekly post' },
            ],
        })) as { agents: Record<string, unknown>[]; next: string }

        expect(result.agents[0]).toMatchObject({ agentId: 'agent-1', started: false })
        expect(result.agents[0].inactive).toBeUndefined()
        expect(result.agents[1]).toMatchObject({ agentId: 'agent-2', inactive: true })

        expect(result.next).toContain('0 agent(s) are working')
        expect(result.next).toContain('1 are built but have no free slot')
        expect(result.next).toContain('1 could not be reached')
    })
})
