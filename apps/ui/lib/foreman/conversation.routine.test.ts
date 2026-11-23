import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), selectMany: vi.fn(), insert: vi.fn(), workspaceFounderUserId: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ insert: mocks.insert }) }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectMany: mocks.selectMany, selectMaybeSingleWithJoins: async () => ({ data: null }) }))
vi.mock('./agent-row', () => ({ ensureForemanAgentRow: async () => 'agent-cos' }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: mocks.workspaceFounderUserId }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ FIRST_MESSAGE_MAX_CHARS: 200, GENERAL_SESSION_TITLE: 'General' }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn() }))

const { findForemanThreadId, openForemanRoutineThread } = await import('./conversation')

const follows = (follow: boolean | undefined) => ({ version: 2, coworkers: follow === undefined ? {} : { foreman: { mode: 'default', follow } } })

function members(users: Array<{ id: string; follow?: boolean }>) {
    mocks.selectMany.mockImplementation(async (_client: unknown, table: string) => {
        if (table === 'workspace_members') return { data: users.map(user => ({ user_id: user.id })) }
        return { data: [...users].reverse().map(user => ({ id: user.id, email_notification_prefs: follows(user.follow) })) }
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectMaybeSingle.mockResolvedValue({ data: null })
    mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'thread-1' }, error: null }) }) })
    mocks.workspaceFounderUserId.mockResolvedValue('founder')
})

describe('openForemanRoutineThread', () => {
    it('opens the thread for the member who follows the Chief of Staff, as the one who scheduled the routine does', async () => {
        members([{ id: 'founder' }, { id: 'scheduler', follow: true }, { id: 'stopped', follow: false }])
        await openForemanRoutineThread(7, 'engine-2', 'schedule: monday-review')
        expect(mocks.insert).toHaveBeenCalledWith({ agent_id: 'agent-cos', owner_user_id: 'scheduler', engine_session_id: 'engine-2', kind: 'thread', status: 'working', source: 'schedule', title: 'schedule: monday-review', automation_name: 'schedule: monday-review' })
        expect(mocks.workspaceFounderUserId).not.toHaveBeenCalled()
    })

    // The members are read by age, the users in whatever order the database answers.
    it('opens it for the longest-standing member when several follow it', async () => {
        members([{ id: 'founder' }, { id: 'first', follow: true }, { id: 'second', follow: true }])
        await openForemanRoutineThread(7, 'engine-2', 'Weekly review')
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_user_id: 'first' }))
        expect(mocks.selectMany.mock.calls[0][4]).toEqual({ column: 'created_at' })
    })

    it("falls back to the workspace's founder when nobody follows it", async () => {
        members([{ id: 'founder' }, { id: 'stopped', follow: false }])
        await openForemanRoutineThread(7, 'engine-2', 'Scheduled run')
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_user_id: 'founder' }))
    })

    it('opens a check-in that spoke for the member it names, waiting to be read, and hands the thread back', async () => {
        members([{ id: 'founder' }, { id: 'scheduler', follow: true }])
        expect(await openForemanRoutineThread(7, 'engine-3', 'Your invoices coworker keeps failing', { userId: 'ana', status: 'awaiting_ack' })).toEqual({ id: 'thread-1', userId: 'ana' })
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_user_id: 'ana', status: 'awaiting_ack', kind: 'thread', engine_session_id: 'engine-3' }))
    })

    it('leaves a check-in nobody checked to whoever reads its routines', async () => {
        members([{ id: 'founder' }, { id: 'scheduler', follow: true }])
        expect(await openForemanRoutineThread(7, 'engine-3', 'A thing to look at', { userId: null, status: 'awaiting_ack' })).toEqual({ id: 'thread-1', userId: 'scheduler' })
    })

    // The engine announces a session once, but its webhook retries.
    it('opens it once for an engine conversation', async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1' } })
        await openForemanRoutineThread(7, 'engine-2', 'Scheduled run')
        expect(mocks.insert).not.toHaveBeenCalled()
    })

    it('opens nothing on a workspace with nobody to read it, and never throws', async () => {
        members([])
        mocks.workspaceFounderUserId.mockResolvedValue(null)
        await openForemanRoutineThread(7, 'engine-2', 'Scheduled run')
        expect(mocks.insert).not.toHaveBeenCalled()
        mocks.selectMaybeSingle.mockRejectedValue(new Error('database away'))
        await expect(openForemanRoutineThread(7, 'engine-2', 'Scheduled run')).resolves.toBeNull()
    })
})

describe('findForemanThreadId', () => {
    const ctx = { workspace: { id: 7 }, userId: 'scheduler' } as never

    it("finds the caller's own thread of an engine conversation, and none of another member's", async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1' } })
        expect(await findForemanThreadId(ctx, 'engine-2')).toBe('row-1')
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ agent_id: 'agent-cos', owner_user_id: 'scheduler', engine_session_id: 'engine-2' })
        mocks.selectMaybeSingle.mockResolvedValue({ data: null })
        expect(await findForemanThreadId(ctx, 'engine-3')).toBeNull()
    })
})
