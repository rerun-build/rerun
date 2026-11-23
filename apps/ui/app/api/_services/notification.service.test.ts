import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), selectMany: vi.fn(), authenticateEngineToken: vi.fn(), openForemanRoutineThread: vi.fn(), openCheckinThread: vi.fn() }))

vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@rerun/cloud/email', () => ({}))
vi.mock('@/lib/ai/generate-run-title', () => ({ generateRunTitle: vi.fn() }))
vi.mock('@rerun/analytics/server', () => ({ captureServer: vi.fn(), deterministicUuid: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle, selectMany: mocks.selectMany }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn() }))
vi.mock('./notification-audience.service', () => ({ writeNotificationPrefs: vi.fn() }))
vi.mock('./presence.service', () => ({ loadPresence: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ authenticateEngineToken: mocks.authenticateEngineToken }))
vi.mock('@/lib/foreman/conversation', () => ({ copyToShippedForemanRow: vi.fn(), openForemanRoutineThread: mocks.openForemanRoutineThread }))
vi.mock('@/lib/foreman/checkin-thread', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/foreman/checkin-thread')>()), openCheckinThread: mocks.openCheckinThread }))
vi.mock('./workspace-owner.service', () => ({ resolveWorkspaceMemberEmail: vi.fn(), resolveWorkspaceOwner: vi.fn() }))

const { membersReachingBox, recordNotification } = await import('./notification.service')

const members = [
    { user_id: 'admin', role: 'admin' as const, box_scope: 'assigned' },
    { user_id: 'open', role: 'member' as const, box_scope: 'all' },
    { user_id: 'assigned', role: 'member' as const, box_scope: 'assigned' },
    { user_id: 'granted', role: 'member' as const, box_scope: 'assigned' },
]

function boxIs(visibility: string | null, grants: { user_id: string; access: string }[] = []) {
    mocks.selectMaybeSingle.mockResolvedValue({ data: visibility === null ? null : { workspace_id: 1, visibility }, error: null })
    mocks.selectMany.mockResolvedValue({ data: grants, error: null })
}

const ids = (rows: { user_id: string }[]) => rows.map(row => row.user_id)

describe('membersReachingBox', () => {
    beforeEach(() => {
        mocks.selectMaybeSingle.mockReset()
        mocks.selectMany.mockReset()
    })

    it('keeps everyone for a notification that names no Box, without reading anything', async () => {
        expect(ids(await membersReachingBox({} as never, 1, null, members))).toEqual(['admin', 'open', 'assigned', 'granted'])
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('keeps the admins, the members of scope all and the granted ones for an open Box', async () => {
        boxIs('workspace', [{ user_id: 'granted', access: 'use' }])
        expect(ids(await membersReachingBox({} as never, 1, 'box', members))).toEqual(['admin', 'open', 'granted'])
    })

    it('keeps only the admins and the granted members for a restricted Box, in one read of each table', async () => {
        boxIs('restricted', [{ user_id: 'granted', access: 'manage' }])
        expect(ids(await membersReachingBox({} as never, 1, 'box', members))).toEqual(['admin', 'granted'])
        expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
        expect(mocks.selectMany).toHaveBeenCalledTimes(1)
        expect(mocks.selectMany.mock.calls[0][3]).toEqual({ space_id: 'box' })
    })

    it('keeps only the admins when the Box is gone', async () => {
        boxIs(null)
        expect(ids(await membersReachingBox({} as never, 1, 'box', members))).toEqual(['admin'])
    })
})

describe('recordNotification for the Chief of Staff', () => {
    const foremanRow = { id: 'agent-cos', name: 'Chief of Staff', space_id: null, kind: 'foreman' }

    beforeEach(() => {
        mocks.selectMaybeSingle.mockReset()
        mocks.openForemanRoutineThread.mockReset()
        mocks.openCheckinThread.mockReset()
        mocks.authenticateEngineToken.mockResolvedValue({ workspaceId: 7, isSandbox: false })
        mocks.selectMaybeSingle.mockResolvedValue({ data: foremanRow, error: null })
    })

    // A routine of its own: the engine opened the session, nobody typed in it.
    it('opens a thread for the conversation a routine of its own started, named after the routine', async () => {
        expect(await recordNotification('token', { event: 'agent.session.created', agentId: 'foreman', sessionId: 'engine-2', title: 'schedule: monday-review', source: 'schedule', timestamp: '2026-11-18T09:00:00.000Z' } as never)).toEqual({ ok: true })
        expect(mocks.selectMaybeSingle.mock.calls[0][3]).toEqual({ workspace_id: 7, engine_agent_id: 'foreman' })
        expect(mocks.openForemanRoutineThread).toHaveBeenCalledWith(7, 'engine-2', 'schedule: monday-review', undefined, 'schedule')
    })

    it('opens the conversation a coworker started with it as a thread of the member behind the call', async () => {
        const called = { event: 'agent.session.created', agentId: 'foreman', sessionId: 'engine-3', title: 'from scout: the figures', source: 'agent', originAgentId: 'scout', metadata: { authorId: 'ana' }, timestamp: '2026-11-23T09:00:00.000Z' }
        expect(await recordNotification('token', called as never)).toEqual({ ok: true })
        expect(mocks.openForemanRoutineThread).toHaveBeenCalledWith(7, 'engine-3', 'from scout: the figures', { userId: 'ana', status: 'working' }, 'agent')
    })

    it('opens a check-in that decided to speak as a thread waiting to be read, pushed outside a sandbox', async () => {
        const announced = { event: 'agent.session.created', kind: 'info', agentId: 'foreman', sessionId: 'engine-5', message: 'Your invoices coworker failed three nights in a row.', title: 'Invoices keep failing', source: 'schedule', metadata: { checkin: { reason: 'pulse' }, memberId: 'ana', aboutAgentIds: [] }, timestamp: '2026-11-19T09:00:00.000Z' }
        expect(await recordNotification('token', announced as never)).toEqual({ ok: true })
        expect(mocks.openCheckinThread).toHaveBeenCalledWith(7, announced, { push: true })
        expect(mocks.openForemanRoutineThread).not.toHaveBeenCalled()
    })
})
