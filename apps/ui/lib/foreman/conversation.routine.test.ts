import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), selectMany: vi.fn(), insert: vi.fn(), workspaceFounderUserId: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ insert: mocks.insert }) }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectMany: mocks.selectMany }))
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
    mocks.insert.mockResolvedValue({ error: null })
    mocks.workspaceFounderUserId.mockResolvedValue('founder')
})

describe('openForemanRoutineThread', () => {
    it('opens the thread for the member who follows the Chief of Staff, as the one who scheduled the routine does', async () => {
        members([{ id: 'founder' }, { id: 'scheduler', follow: true }, { id: 'stopped', follow: false }])
        await openForemanRoutineThread(7, 'engine-2', 'schedule: monday-review')
        expect(mocks.insert).toHaveBeenCalledWith({ workspace_id: 7, user_id: 'scheduler', backend: 'engine', engine_session_id: 'engine-2', kind: 'thread', status: 'working', title: 'schedule: monday-review' })
        expect(mocks.workspaceFounderUserId).not.toHaveBeenCalled()
    })

    // The members are read by age, the users in whatever order the database answers.
    it('opens it for the longest-standing member when several follow it', async () => {
        members([{ id: 'founder' }, { id: 'first', follow: true }, { id: 'second', follow: true }])
        await openForemanRoutineThread(7, 'engine-2', 'Weekly review')
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'first' }))
        expect(mocks.selectMany.mock.calls[0][4]).toEqual({ column: 'created_at' })
    })

    it("falls back to the workspace's founder when nobody follows it", async () => {
        members([{ id: 'founder' }, { id: 'stopped', follow: false }])
        await openForemanRoutineThread(7, 'engine-2', 'Scheduled run')
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'founder' }))
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
        await expect(openForemanRoutineThread(7, 'engine-2', 'Scheduled run')).resolves.toBeUndefined()
    })
})

describe('findForemanThreadId', () => {
    const ctx = { workspace: { id: 7 }, userId: 'scheduler' } as never

    it("finds the caller's own thread of an engine conversation, and none of another member's", async () => {
        mocks.selectMaybeSingle.mockResolvedValue({ data: { id: 'row-1' } })
        expect(await findForemanThreadId(ctx, 'engine-2')).toBe('row-1')
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ workspace_id: 7, user_id: 'scheduler', engine_session_id: 'engine-2' })
        mocks.selectMaybeSingle.mockResolvedValue({ data: null })
        expect(await findForemanThreadId(ctx, 'engine-3')).toBeNull()
    })
})
