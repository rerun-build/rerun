import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getSessionWorkspace: vi.fn(),
    selectMaybeSingle: vi.fn(),
    selectMaybeSingleWithJoins: vi.fn(),
    selectMany: vi.fn(),
    selectAll: vi.fn(),
}))

vi.mock('@/supabase/session/getServerSession', () => ({ getServerSession: mocks.getSessionWorkspace, getSessionWorkspace: mocks.getSessionWorkspace }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectSingle: vi.fn(), selectMaybeSingle: mocks.selectMaybeSingle, selectMaybeSingleWithJoins: mocks.selectMaybeSingleWithJoins, selectMany: mocks.selectMany, selectAll: mocks.selectAll }))

const { AuthorizationError } = await import('./ownership')
const { AccessDeniedError, assertAgentAccess, assertSessionInWorkspace, boxAccessOf, callableEngineAgentIds, hasAccess, keepVisible, visibleSpaceIds, workspaceActor } = await import('./access')
type Actor = import('./access').Actor

const admin: Actor = { kind: 'user', userId: 'u-admin', workspaceId: 1, role: 'admin', boxScope: 'all' }
const member = (boxScope: 'all' | 'assigned'): Actor => ({ kind: 'user', userId: 'u-member', workspaceId: 1, role: 'member', boxScope })
const openBox = { workspace_id: 1, visibility: 'workspace' }
const restrictedBox = { workspace_id: 1, visibility: 'restricted' }

describe('boxAccessOf', () => {
    it('lets an admin manage every Box of the workspace, a grant or not', () => {
        expect(boxAccessOf(admin, restrictedBox, null)).toBe('manage')
        expect(boxAccessOf(admin, openBox, 'use')).toBe('manage')
    })

    it('lets the workspace itself manage every Box, as its admins would', () => {
        expect(boxAccessOf(workspaceActor(1), restrictedBox, null)).toBe('manage')
    })

    it('lets a member of scope all use a Box open to the workspace', () => {
        expect(boxAccessOf(member('all'), openBox, null)).toBe('use')
    })

    it('closes a restricted Box to a member of scope all without a grant', () => {
        expect(boxAccessOf(member('all'), restrictedBox, null)).toBe('none')
    })

    it('closes even an open Box to a member of scope assigned without a grant', () => {
        expect(boxAccessOf(member('assigned'), openBox, null)).toBe('none')
    })

    it('gives a granted member the level of the grant', () => {
        expect(boxAccessOf(member('assigned'), restrictedBox, 'use')).toBe('use')
        expect(boxAccessOf(member('assigned'), openBox, 'manage')).toBe('manage')
        expect(boxAccessOf(member('all'), openBox, 'manage')).toBe('manage')
        expect(boxAccessOf(member('all'), restrictedBox, 'manage')).toBe('manage')
    })

    it('reads a missing visibility as open to the workspace', () => {
        expect(boxAccessOf(member('all'), { workspace_id: 1, visibility: null }, null)).toBe('use')
    })

    it('closes a Box of another workspace to everyone, an admin and a grant included', () => {
        const foreign = { workspace_id: 2, visibility: 'workspace' }
        expect(boxAccessOf(admin, foreign, null)).toBe('none')
        expect(boxAccessOf(workspaceActor(1), foreign, null)).toBe('none')
        expect(boxAccessOf(member('all'), foreign, 'manage')).toBe('none')
    })
})

describe('hasAccess', () => {
    it('counts manage as use, and nothing else as enough', () => {
        expect(hasAccess('manage', 'use')).toBe(true)
        expect(hasAccess('manage', 'manage')).toBe(true)
        expect(hasAccess('use', 'use')).toBe(true)
        expect(hasAccess('use', 'manage')).toBe(false)
        expect(hasAccess('none', 'use')).toBe(false)
        expect(hasAccess('none', 'manage')).toBe(false)
    })
})

describe('keepVisible', () => {
    it('keeps everything for all, and only the listed ids otherwise', () => {
        const rows = [{ id: 'a' }, { id: 'b' }, { id: null }]
        expect(keepVisible(rows, 'all', row => row.id)).toEqual(rows)
        expect(keepVisible(rows, new Set(['b']), row => row.id)).toEqual([{ id: 'b' }])
    })
})

type Tables = { agents?: unknown; spaces?: unknown; space_members?: unknown }

function readsAnswering(tables: Tables) {
    mocks.selectMaybeSingle.mockImplementation(async (_client: unknown, table: keyof Tables) => ({ data: tables[table] ?? null, error: null }))
}

describe('assertAgentAccess', () => {
    beforeEach(() => {
        mocks.getSessionWorkspace.mockReset()
        mocks.selectMaybeSingle.mockReset()
    })

    const agent = { workspace_id: 1, space_id: 'box-1', engine_agent_id: 'e1' }

    it('hands back the agent and the level for a member of an open Box', async () => {
        readsAnswering({ agents: agent, spaces: { id: 'box-1', ...openBox } })
        await expect(assertAgentAccess('a1', 'use', member('all'))).resolves.toEqual({ actor: member('all'), access: 'use', agent })
    })

    it('refuses a change to a member who only uses the Box, with a reason it can show', async () => {
        readsAnswering({ agents: agent, spaces: { id: 'box-1', ...openBox } })
        const error = await assertAgentAccess('a1', 'manage', member('all')).catch(e => e)
        expect(error).toBeInstanceOf(AccessDeniedError)
    })

    it('answers a coworker in a Box the member does not reach as missing', async () => {
        readsAnswering({ agents: agent, spaces: { id: 'box-1', ...restrictedBox } })
        const error = await assertAgentAccess('a1', 'use', member('all')).catch(e => e)
        expect(error).toBeInstanceOf(AuthorizationError)
        expect(error).not.toBeInstanceOf(AccessDeniedError)
        expect(error.message).toBe('Coworker not found')
    })

    it('lets a member who manages the Box through a grant change the coworker', async () => {
        readsAnswering({ agents: agent, spaces: { id: 'box-1', ...restrictedBox }, space_members: { access: 'manage' } })
        await expect(assertAgentAccess('a1', 'manage', member('assigned'))).resolves.toMatchObject({ access: 'manage' })
    })

    it('refuses a coworker of another workspace before reading its Box', async () => {
        readsAnswering({ agents: { ...agent, workspace_id: 2 } })
        await expect(assertAgentAccess('a1', 'use', admin)).rejects.toThrow('Coworker not found')
        expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
    })

    const chief = { workspace_id: 1, space_id: null, engine_agent_id: 'foreman', kind: 'foreman' }

    it('lets every member use the Chief of Staff, without a Box to read', async () => {
        readsAnswering({ agents: chief })
        await expect(assertAgentAccess('cos', 'use', member('assigned'))).resolves.toMatchObject({ access: 'use', agent: chief })
        expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
    })

    it('keeps managing the Chief of Staff to admins, since every member reaches what it is given', async () => {
        readsAnswering({ agents: chief })
        await expect(assertAgentAccess('cos', 'manage', member('all'))).rejects.toBeInstanceOf(AccessDeniedError)
        await expect(assertAgentAccess('cos', 'manage', admin)).resolves.toMatchObject({ access: 'manage' })
        await expect(assertAgentAccess('cos', 'manage', workspaceActor(1))).resolves.toMatchObject({ access: 'manage' })
    })

    it("refuses another workspace's Chief of Staff as missing", async () => {
        readsAnswering({ agents: { ...chief, workspace_id: 2 } })
        await expect(assertAgentAccess('cos', 'use', admin)).rejects.toThrow('Coworker not found')
    })

    it('reads the caller from the session when no actor is passed', async () => {
        mocks.getSessionWorkspace.mockResolvedValue({ user: { id: 'u-member', workspace_id: 1 }, workspaceRefused: false, membership: { role: 'member', box_scope: 'assigned' } })
        readsAnswering({ agents: agent, spaces: { id: 'box-1', ...openBox } })
        await expect(assertAgentAccess('a1', 'use')).rejects.toThrow('Coworker not found')
    })
})

describe('assertSessionInWorkspace', () => {
    beforeEach(() => {
        mocks.getSessionWorkspace.mockReset()
        mocks.selectMaybeSingle.mockReset()
        mocks.selectMaybeSingleWithJoins.mockReset()
    })

    const row = (workspaceId: number | null) => ({ id: 'se1', agent_id: 'a1', engine_session_id: 'es1', agent: workspaceId === null ? null : { workspace_id: workspaceId, space_id: 'box-1', engine_agent_id: 'e1' } })

    it('returns a session whose agent sits in a Box the caller reaches, from one read joined to its agent', async () => {
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: row(1), error: null })
        readsAnswering({ spaces: { id: 'box-1', ...openBox } })
        await expect(assertSessionInWorkspace('se1', member('all'))).resolves.toEqual({ id: 'se1', agent_id: 'a1', engine_session_id: 'es1', engine_agent_id: 'e1' })
        const [, table, , joins, filters] = mocks.selectMaybeSingleWithJoins.mock.calls[0]
        expect(table).toBe('sessions')
        expect(joins.agent.foreignKey).toBe('agents!sessions_agent_id_fkey')
        expect(filters).toEqual({ id: 'se1' })
        expect(mocks.getSessionWorkspace).not.toHaveBeenCalled()
    })

    it('refuses a session of a coworker in a Box the member does not reach', async () => {
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: row(1), error: null })
        readsAnswering({ spaces: { id: 'box-1', ...restrictedBox } })
        await expect(assertSessionInWorkspace('se1', member('all'))).rejects.toThrow('Session not found')
    })

    const chiefSession = (ownerId: string) => ({ id: 'se2', agent_id: 'cos', engine_session_id: 'es2', owner_id: ownerId, agent: { workspace_id: 1, space_id: null, engine_agent_id: 'foreman', kind: 'foreman' } })

    it("opens a conversation with the Chief of Staff to its owner only, an admin included", async () => {
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: chiefSession('u-member'), error: null })
        await expect(assertSessionInWorkspace('se2', member('assigned'))).resolves.toEqual({ id: 'se2', agent_id: 'cos', engine_session_id: 'es2', engine_agent_id: 'foreman' })
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: chiefSession('u-member'), error: null })
        await expect(assertSessionInWorkspace('se2', admin)).rejects.toThrow('Session not found')
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: chiefSession('u-member'), error: null })
        await expect(assertSessionInWorkspace('se2', workspaceActor(1))).rejects.toThrow('Session not found')
    })

    it('refuses a session whose agent belongs to another workspace, or is missing', async () => {
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: row(2), error: null })
        await expect(assertSessionInWorkspace('se1', admin)).rejects.toThrow('Session not found')
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: row(null), error: null })
        await expect(assertSessionInWorkspace('se1', admin)).rejects.toBeInstanceOf(AuthorizationError)
        mocks.selectMaybeSingleWithJoins.mockResolvedValueOnce({ data: null, error: null })
        await expect(assertSessionInWorkspace('se1', admin)).rejects.toThrow('Session not found')
    })
})

describe('visibleSpaceIds', () => {
    beforeEach(() => {
        mocks.selectAll.mockReset()
        mocks.selectMany.mockReset()
    })

    it('answers all for an admin and for the workspace without reading anything', async () => {
        await expect(visibleSpaceIds(admin)).resolves.toBe('all')
        await expect(visibleSpaceIds(workspaceActor(1))).resolves.toBe('all')
        expect(mocks.selectAll).not.toHaveBeenCalled()
    })

    it('lists the open Boxes and the granted ones for a member, in two reads', async () => {
        mocks.selectAll.mockResolvedValue({ data: [{ id: 'open', ...openBox }, { id: 'closed', ...restrictedBox }, { id: 'granted', ...restrictedBox }], error: null })
        mocks.selectMany.mockResolvedValue({ data: [{ space_id: 'granted', access: 'use' }], error: null })
        await expect(visibleSpaceIds(member('all'))).resolves.toEqual(new Set(['open', 'granted']))
        await expect(visibleSpaceIds(member('assigned'))).resolves.toEqual(new Set(['granted']))
    })
})

describe('callableEngineAgentIds', () => {
    beforeEach(() => {
        mocks.selectAll.mockReset()
        mocks.selectMany.mockReset()
    })

    const spaces = (rows: { id: string; workspace_id: number; visibility: string }[]) => ({ data: rows, error: null })

    it('names nobody for an admin or the workspace, so every coworker stays callable', async () => {
        await expect(callableEngineAgentIds(admin)).resolves.toBeUndefined()
        await expect(callableEngineAgentIds(workspaceActor(1))).resolves.toBeUndefined()
        expect(mocks.selectAll).not.toHaveBeenCalled()
    })

    it('names nobody for a member who reaches every Box', async () => {
        mocks.selectAll.mockResolvedValueOnce(spaces([{ id: 'open', ...openBox }]))
        mocks.selectMany.mockResolvedValue({ data: [], error: null })
        await expect(callableEngineAgentIds(member('all'))).resolves.toBeUndefined()
    })

    it('lists the engine ids of the coworkers in the Boxes a member reaches', async () => {
        mocks.selectAll.mockResolvedValueOnce(spaces([{ id: 'open', ...openBox }, { id: 'closed', ...restrictedBox }]))
        mocks.selectAll.mockResolvedValueOnce({ data: [{ engine_agent_id: 'engine-open' }, { engine_agent_id: null }], error: null })
        mocks.selectMany.mockResolvedValue({ data: [], error: null })

        await expect(callableEngineAgentIds(member('all'))).resolves.toEqual(['engine-open'])
        expect(mocks.selectAll.mock.calls[1][3]).toEqual({ workspace_id: 1, space_id: ['open'] })
    })

    it('lists nobody for a member who reaches no Box at all', async () => {
        mocks.selectAll.mockResolvedValueOnce(spaces([{ id: 'closed', ...restrictedBox }]))
        mocks.selectMany.mockResolvedValue({ data: [], error: null })
        await expect(callableEngineAgentIds(member('assigned'))).resolves.toEqual([])
        expect(mocks.selectAll).toHaveBeenCalledOnce()
    })
})
