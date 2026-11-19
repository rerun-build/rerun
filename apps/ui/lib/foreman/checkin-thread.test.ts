import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ memberActor: vi.fn(), visibleAgentIds: vi.fn(), openForemanRoutineThread: vi.fn(), pushNotification: vi.fn(), selectMaybeSingle: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/access', () => ({ memberActor: mocks.memberActor, visibleAgentIds: mocks.visibleAgentIds }))
vi.mock('@/lib/foreman/conversation', () => ({ openForemanRoutineThread: mocks.openForemanRoutineThread }))
vi.mock('./conversation', () => ({ openForemanRoutineThread: mocks.openForemanRoutineThread }))
vi.mock('@rerun/cloud/email', () => ({ pushNotification: mocks.pushNotification }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle }))

const { checkinReaderOf, isCheckinAnnouncement, openCheckinThread } = await import('./checkin-thread')

const ana = { kind: 'user', userId: 'ana', workspaceId: 7, role: 'member', boxScope: 'assigned' }

const payload = (metadata: Record<string, unknown>) => ({ event: 'agent.session.created' as const, kind: 'info' as const, agentId: 'foreman', sessionId: 'engine-9', runId: 'r9', message: 'Your invoices coworker failed three nights in a row.', title: 'Invoices keep failing', metadata, source: 'schedule' as const, timestamp: '2026-11-19T08:00:00.000Z' })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.memberActor.mockResolvedValue(ana)
    mocks.visibleAgentIds.mockResolvedValue('all')
    mocks.openForemanRoutineThread.mockResolvedValue({ id: 'thread-1', userId: 'ana' })
    mocks.selectMaybeSingle.mockImplementation(async (_client: unknown, table: string) => (table === 'users' ? { data: { email_notification_prefs: null } } : { data: { answers: { foreman: { name: 'Max' } } } }))
})

describe('isCheckinAnnouncement', () => {
    it('tells a check-in that spoke from a routine of the foreman', () => {
        expect(isCheckinAnnouncement(payload({ checkin: { reason: 'pulse' } }))).toBe(true)
        expect(isCheckinAnnouncement(payload({}))).toBe(false)
        expect(isCheckinAnnouncement({ event: 'agent.schedule.completed', metadata: { checkin: { reason: 'pulse' } } })).toBe(false)
    })
})

describe('checkinReaderOf', () => {
    it('keeps the member the engine named when they see the whole workspace', async () => {
        expect(await checkinReaderOf(7, { memberId: 'ana', aboutAgentIds: ['agent-invoices'] })).toBe('ana')
        expect(await checkinReaderOf(7, { memberId: 'ana' })).toBe('ana')
    })

    it('drops a member kept to some Boxes, even for a coworker of theirs: the thread holds all the run read', async () => {
        mocks.visibleAgentIds.mockResolvedValue(new Set(['agent-invoices']))
        expect(await checkinReaderOf(7, { memberId: 'ana', aboutAgentIds: ['agent-invoices'] })).toBeNull()
        expect(await checkinReaderOf(7, { memberId: 'ana', aboutAgentIds: [] })).toBeNull()
    })

    it('drops a member who left, or none named at all', async () => {
        mocks.memberActor.mockResolvedValue(null)
        expect(await checkinReaderOf(7, { memberId: 'ana' })).toBeNull()
        expect(await checkinReaderOf(7, {})).toBeNull()
    })
})

describe('openCheckinThread', () => {
    it("opens the thread waiting to be read and pushes it under the Chief of Staff's name, linked to the thread", async () => {
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' }, memberId: 'ana', aboutAgentIds: ['agent-invoices'] }), { push: true })
        expect(mocks.openForemanRoutineThread).toHaveBeenCalledWith(7, 'engine-9', 'Invoices keep failing', { userId: 'ana', status: 'awaiting_ack' })
        expect(mocks.pushNotification).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceId: 7, agentId: 'foreman', agentName: 'Max', conversationId: 'thread-1', recipients: { ana: 'workspace' }, notification: expect.objectContaining({ kind: 'info', message: 'Your invoices coworker failed three nights in a row.' }) }))
    })

    it('hands a member it cannot verify over to whoever reads the routines', async () => {
        mocks.memberActor.mockResolvedValue(null)
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' }, memberId: 'ghost' }), { push: true })
        expect(mocks.openForemanRoutineThread).toHaveBeenCalledWith(7, 'engine-9', 'Invoices keep failing', { userId: null, status: 'awaiting_ack' })
    })

    it('pushes nothing to someone who muted it or asked for nothing, nor twice for one check-in, nor from a sandbox', async () => {
        mocks.selectMaybeSingle.mockImplementation(async (_client: unknown, table: string) => (table === 'users' ? { data: { email_notification_prefs: { version: 2, scope: 'nothing' } } } : { data: null }))
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' } }), { push: true })
        mocks.selectMaybeSingle.mockImplementation(async (_client: unknown, table: string) => (table === 'users' ? { data: { email_notification_prefs: { version: 2, coworkers: { foreman: { mode: 'muted', follow: false } } } } } : { data: null }))
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' } }), { push: true })
        mocks.openForemanRoutineThread.mockResolvedValue(null)
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' } }), { push: true })
        mocks.openForemanRoutineThread.mockResolvedValue({ id: 'thread-2', userId: 'ana' })
        await openCheckinThread(7, payload({ checkin: { reason: 'pulse' } }), { push: false })
        expect(mocks.pushNotification).not.toHaveBeenCalled()
    })
})
