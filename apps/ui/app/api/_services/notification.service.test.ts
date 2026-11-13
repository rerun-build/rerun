import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ selectMaybeSingle: vi.fn(), selectMany: vi.fn(), authenticateEngineToken: vi.fn(), setForemanConversationStatus: vi.fn() }))

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
vi.mock('@/lib/foreman/conversation', () => ({ setForemanConversationStatus: mocks.setForemanConversationStatus }))
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

describe('recordNotification for the foreman', () => {
    const foremanEvent = (event: string, kind: string) => ({ event, kind, agentId: 'foreman', sessionId: 'engine-1', message: 'Done', timestamp: '2026-11-13T16:00:00.000Z' }) as never

    beforeEach(() => {
        mocks.selectMaybeSingle.mockReset()
        mocks.setForemanConversationStatus.mockReset()
        mocks.authenticateEngineToken.mockResolvedValue({ workspaceId: 7, isSandbox: false })
    })

    it('puts the thread back to idle when its run is over, without storing any news', async () => {
        expect(await recordNotification('token', foremanEvent('agent.message.completed', 'done'))).toEqual({ ok: true })
        expect(mocks.setForemanConversationStatus).toHaveBeenCalledWith(7, 'engine-1', 'idle')
        expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('marks the thread as waiting on a question the foreman asked', async () => {
        await recordNotification('token', foremanEvent('agent.notification', 'question'))
        expect(mocks.setForemanConversationStatus).toHaveBeenCalledWith(7, 'engine-1', 'awaiting_question')
    })

    it('marks the thread as failed when its run errored', async () => {
        await recordNotification('token', foremanEvent('agent.message.completed', 'error'))
        expect(mocks.setForemanConversationStatus).toHaveBeenCalledWith(7, 'engine-1', 'error')
    })
})
