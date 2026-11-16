import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

const mocks = vi.hoisted(() => ({
    requireLightSessionActor: vi.fn(),
    visibleSpaceIds: vi.fn(),
    selectMaybeSingle: vi.fn(),
    selectMaybeSingleWithJoins: vi.fn(),
    selectManyWithJoins: vi.fn(),
    findWorkspaceEngine: vi.fn(),
    listRuns: vi.fn(),
    selectMany: vi.fn(),
    sessionUpdate: vi.fn(),
}))

vi.mock('@/app/api/_auth/access', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/access')>()), requireLightSessionActor: mocks.requireLightSessionActor, visibleSpaceIds: mocks.visibleSpaceIds }))
vi.mock('@/supabase/serviceRole', () => ({
    createServiceRoleClient: () => ({
        from: (table: string) => ({
            update: (payload: unknown) => {
                const filters: Record<string, unknown> = {}
                const query = {
                    eq: (column: string, value: unknown) => {
                        filters[column] = value
                        return query
                    },
                    then: (resolve: (value: { error: null }) => unknown) => {
                        mocks.sessionUpdate(table, payload, filters)
                        return Promise.resolve({ error: null }).then(resolve)
                    },
                }
                return query
            },
        }),
    }),
}))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingleWithJoins: mocks.selectMaybeSingleWithJoins, selectManyWithJoins: mocks.selectManyWithJoins, selectMaybeSingle: mocks.selectMaybeSingle, selectSingle: vi.fn(), selectCount: vi.fn(), selectMany: mocks.selectMany, selectAll: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ listRuns: mocks.listRuns, getRunSteps: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: mocks.findWorkspaceEngine, NoEngineError: class NoEngineError extends Error {} }))

const { AuthorizationError } = await import('@/app/api/_auth/ownership')
const { AccessDeniedError, workspaceActor } = await import('@/app/api/_auth/access')
type Actor = import('@/app/api/_auth/access').Actor
const { clearSkillProposalAttention, findIdleSessions, lastRunError, resolveAgentTarget, resolveAgentTargetForTrigger, summarizeSessionRuns } = await import('./chat.service')

const conn = { baseUrl: 'https://engine', apiKey: 'k' }

type AgentRow = {
    workspace_id: number
    space_id: string
    engine_agent_id: string | null
    disabled_at: string | null
    disabled_reason: string | null
    space: { visibility: string } | null
}

const admin: Actor = { kind: 'user', userId: 'u1', workspaceId: 1, role: 'admin', boxScope: 'all' }
const member = (boxScope: 'all' | 'assigned'): Actor => ({ kind: 'user', userId: 'u2', workspaceId: 1, role: 'member', boxScope })

let row: AgentRow | null

beforeEach(() => {
    row = { workspace_id: 1, space_id: 'box-1', engine_agent_id: 'e1', disabled_at: null, disabled_reason: null, space: { visibility: 'workspace' } }
    mocks.requireLightSessionActor.mockReset().mockResolvedValue(admin)
    mocks.selectMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
    mocks.selectMaybeSingleWithJoins.mockReset().mockImplementation(async () => ({ data: row, error: null }))
    mocks.findWorkspaceEngine.mockReset().mockResolvedValue({ instanceId: 'i1', conn, managed: true })
})

describe('resolveAgentTarget', () => {
    it('resolves the engine agent for the session caller', async () => {
        await expect(resolveAgentTarget('a1')).resolves.toEqual({ engineAgentId: 'e1', conn })
        expect(mocks.selectMaybeSingleWithJoins.mock.calls[0][4]).toEqual({ id: 'a1' })
        expect(mocks.findWorkspaceEngine).toHaveBeenCalledWith(1)
    })

    it('reads the machine of the caller, never the one of the agent it was asked about', async () => {
        row = { ...row!, workspace_id: 2 }
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toBeInstanceOf(AuthorizationError)
        expect(mocks.findWorkspaceEngine).toHaveBeenCalledWith(1)
    })

    it('reports a workspace without a machine', async () => {
        mocks.findWorkspaceEngine.mockResolvedValue(null)
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toThrow()
    })

    it('skips the session lookup when the caller passes an actor, an API key or a v1 context', async () => {
        await expect(resolveAgentTarget('a1', workspaceActor(1), 'manage')).resolves.toMatchObject({ engineAgentId: 'e1' })
        expect(mocks.requireLightSessionActor).not.toHaveBeenCalled()
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('refuses an agent of another workspace than the actor one', async () => {
        await expect(resolveAgentTarget('a1', workspaceActor(2))).rejects.toBeInstanceOf(AuthorizationError)
    })

    it('refuses an agent of another workspace than the session one', async () => {
        mocks.requireLightSessionActor.mockResolvedValue({ ...admin, workspaceId: 2 })
        await expect(resolveAgentTarget('a1')).rejects.toThrow('Coworker not found')
    })

    it('refuses an agent that does not exist', async () => {
        row = null
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toBeInstanceOf(AuthorizationError)
    })

    it('lets a member use a coworker of an open Box, and refuses a change with a reason', async () => {
        await expect(resolveAgentTarget('a1', member('all'))).resolves.toMatchObject({ engineAgentId: 'e1' })
        const refused = await resolveAgentTarget('a1', member('all'), 'manage').catch(e => e)
        expect(refused).toBeInstanceOf(AccessDeniedError)
    })

    it('hides a coworker of a Box the member does not reach, as missing rather than forbidden', async () => {
        row = { ...row!, space: { visibility: 'restricted' } }
        const restricted = await resolveAgentTarget('a1', member('all')).catch(e => e)
        expect(restricted).toBeInstanceOf(AuthorizationError)
        expect(restricted).not.toBeInstanceOf(AccessDeniedError)

        row = { ...row, space: { visibility: 'workspace' } }
        await expect(resolveAgentTarget('a1', member('assigned'))).rejects.toThrow('Coworker not found')
    })

    it('lets a member who manages the Box change the coworker, and reads that grant on the Box', async () => {
        row = { ...row!, space: { visibility: 'restricted' } }
        mocks.selectMaybeSingle.mockResolvedValue({ data: { access: 'manage' }, error: null })
        await expect(resolveAgentTarget('a1', member('assigned'), 'manage')).resolves.toMatchObject({ engineAgentId: 'e1' })
        expect(mocks.selectMaybeSingle.mock.calls[0][1]).toBe('space_members')
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ space_id: 'box-1', user_id: 'u2' })
    })

    it('tells a plan-limited agent apart from a revoked template', async () => {
        row = { ...row!, disabled_at: '2026-09-01', disabled_reason: 'plan_limit' }
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toThrow(/no free coworker slot/)

        row = { ...row, disabled_reason: null }
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toThrow(/no free coworker slot/)

        row = { ...row, disabled_reason: 'template_revoked' }
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toThrow(/template subscription it came from has ended/)
    })

    it('refuses an agent the engine does not know yet', async () => {
        row = { ...row!, engine_agent_id: null }
        await expect(resolveAgentTarget('a1', workspaceActor(1))).rejects.toThrow('Coworker not configured or not found')
    })
})

describe('resolveAgentTargetForTrigger', () => {
    it('resolves any agent without comparing workspaces, since the token is the authorization', async () => {
        row = { ...row!, workspace_id: 42 }
        await expect(resolveAgentTargetForTrigger('a1')).resolves.toEqual({ engineAgentId: 'e1', conn })
        expect(mocks.requireLightSessionActor).not.toHaveBeenCalled()
        expect(mocks.findWorkspaceEngine).toHaveBeenCalledWith(42)
    })

    it('answers null for a disabled agent', async () => {
        row = { ...row!, disabled_at: '2026-09-01' }
        await expect(resolveAgentTargetForTrigger('a1')).resolves.toBeNull()
    })

    it('answers null for an agent without an engine id', async () => {
        row = { ...row!, engine_agent_id: null }
        await expect(resolveAgentTargetForTrigger('a1')).resolves.toBeNull()
    })

    it('answers null for an unknown agent', async () => {
        row = null
        await expect(resolveAgentTargetForTrigger('a1')).resolves.toBeNull()
    })

    it('answers null when the workspace has no machine', async () => {
        mocks.findWorkspaceEngine.mockResolvedValue(null)
        await expect(resolveAgentTargetForTrigger('a1')).resolves.toBeNull()
    })
})

function run(id: string, sessionId: string, status: string, startedAt: string, error: string | null = null) {
    return { id, sessionId, status, startedAt, error } as Parameters<typeof summarizeSessionRuns>[0][number]
}

describe('summarizeSessionRuns', () => {
    it('keeps the runs of the session, newest first, even from an engine that ignored the filter', () => {
        const runs = [run('old', 's1', 'done', '2026-09-01'), run('other', 's2', 'running', '2026-09-03'), run('new', 's1', 'error', '2026-09-02', 'boom'), run('live', 's1', 'running', '2026-08-30')]
        const summary = summarizeSessionRuns(runs, 's1')
        expect(summary.latest?.id).toBe('new')
        expect(summary.lastDone?.id).toBe('old')
        expect(summary.running?.id).toBe('live')
    })

    it('answers nothing for a session without runs', () => {
        expect(summarizeSessionRuns([run('other', 's2', 'done', '2026-09-01')], 's1')).toEqual({ latest: undefined, lastDone: undefined, running: undefined })
    })
})

describe('lastRunError', () => {
    it('speaks only for a newest run that failed', () => {
        expect(lastRunError(run('r', 's', 'error', '2026-09-01', '  quota exceeded '))).toBe('quota exceeded')
        expect(lastRunError(run('r', 's', 'done', '2026-09-01', 'stale'))).toBeNull()
        expect(lastRunError(run('r', 's', 'error', '2026-09-01', '   '))).toBeNull()
        expect(lastRunError(undefined)).toBeNull()
    })
})

describe('findIdleSessions', () => {
    const agent = (workspaceId: number, engineAgentId: string | null, spaceId = 'box-1') => ({ workspace_id: workspaceId, space_id: spaceId, engine_agent_id: engineAgentId })

    beforeEach(() => {
        mocks.listRuns.mockReset()
        mocks.visibleSpaceIds.mockReset().mockResolvedValue('all')
    })

    it('leaves out the sessions of a Box the member cannot see, without asking the engine about them', async () => {
        const member: Actor = { kind: 'user', userId: 'u-member', workspaceId: 1, role: 'member', boxScope: 'assigned' }
        mocks.visibleSpaceIds.mockResolvedValue(new Set(['box-1']))
        mocks.selectManyWithJoins.mockResolvedValue({
            data: [
                { id: 'mine', engine_session_id: 'es-mine', agent: agent(1, 'e1', 'box-1') },
                { id: 'hidden', engine_session_id: 'es-hidden', agent: agent(1, 'e2', 'box-2') },
            ],
            error: null,
        })
        mocks.listRuns.mockResolvedValue([])

        await expect(findIdleSessions(['mine', 'hidden'], member)).resolves.toEqual(['mine'])
        expect(mocks.visibleSpaceIds).toHaveBeenCalledWith(member)
        expect(mocks.listRuns).toHaveBeenCalledTimes(1)
        expect(mocks.listRuns.mock.calls[0][1]).toBe('e1')
    })

    it('asks the engine once per agent and keeps only the sessions with no run in flight', async () => {
        mocks.selectManyWithJoins.mockResolvedValue({
            data: [
                { id: 'busy', engine_session_id: 'es-busy', agent: agent(1, 'e1') },
                { id: 'idle', engine_session_id: 'es-idle', agent: agent(1, 'e1') },
                { id: 'idle-2', engine_session_id: 'es-idle-2', agent: agent(1, 'e2') },
            ],
            error: null,
        })
        mocks.listRuns.mockImplementation(async (_conn: unknown, engineAgentId: string) => (engineAgentId === 'e1' ? [run('r1', 'es-busy', 'running', '2026-09-01')] : []))

        await expect(findIdleSessions(['busy', 'idle', 'idle-2'], workspaceActor(1))).resolves.toEqual(expect.arrayContaining(['idle', 'idle-2']))
        expect(mocks.listRuns).toHaveBeenCalledTimes(2)
        expect(mocks.listRuns.mock.calls[0][2]).toEqual({ status: 'running', limit: 200 })
    })

    it('ignores a session of another workspace and leaves one it could not ask about as it was', async () => {
        mocks.selectManyWithJoins.mockResolvedValue({
            data: [
                { id: 'foreign', engine_session_id: 'es-f', agent: agent(2, 'e9') },
                { id: 'unreachable', engine_session_id: 'es-u', agent: agent(1, 'e1') },
            ],
            error: null,
        })
        mocks.listRuns.mockRejectedValue(new Error('engine down'))

        await expect(findIdleSessions(['foreign', 'unreachable'], workspaceActor(1))).resolves.toEqual([])
    })

    it('counts a session never mirrored to the engine, or on a workspace without a machine, as idle', async () => {
        mocks.selectManyWithJoins.mockResolvedValue({ data: [{ id: 'orphan', engine_session_id: null, agent: agent(1, 'e1') }], error: null })
        await expect(findIdleSessions(['orphan'], workspaceActor(1))).resolves.toEqual(['orphan'])

        mocks.findWorkspaceEngine.mockResolvedValue(null)
        mocks.selectManyWithJoins.mockResolvedValue({ data: [{ id: 's', engine_session_id: 'es', agent: agent(1, 'e1') }], error: null })
        await expect(findIdleSessions(['s'], workspaceActor(1))).resolves.toEqual(['s'])
        expect(mocks.listRuns).not.toHaveBeenCalled()
    })
})

describe('clearSkillProposalAttention', () => {
    beforeEach(() => {
        mocks.selectMany.mockReset()
        mocks.sessionUpdate.mockReset()
    })

    it('puts the session back to idle when the proposal is what it was waiting on', async () => {
        mocks.selectMany.mockResolvedValue({ data: [{ metadata: { toolName: 'skill_propose', proposalId: 'p1' } }], error: null })

        await clearSkillProposalAttention('s1', 'a1', 'es1')

        expect(mocks.selectMany.mock.calls[0][3]).toEqual({ agent_id: 'a1', engine_session_id: 'es1', kind: { neq: 'done' } })
        expect(mocks.sessionUpdate).toHaveBeenCalledWith('sessions', { status: 'idle' }, { id: 's1', status: 'awaiting_approval' })
    })

    it('leaves a session waiting on a real approval alone', async () => {
        mocks.selectMany.mockResolvedValue({ data: [{ metadata: { toolName: 'request_approval', toolCallId: 'c1' } }], error: null })

        await clearSkillProposalAttention('s1', 'a1', 'es1')

        expect(mocks.sessionUpdate).not.toHaveBeenCalled()
    })

    it('does nothing for a session the engine never opened', async () => {
        await clearSkillProposalAttention('s1', 'a1', null)

        expect(mocks.selectMany).not.toHaveBeenCalled()
        expect(mocks.sessionUpdate).not.toHaveBeenCalled()
    })
})
