import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memberActor, visibleSpaceIds } from '@/app/api/_auth/access'
import { pushNotification } from '@rerun/cloud/email'
import { setForemanConversationStatus } from '@/lib/foreman/conversation'
import type { NotificationPayload } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { recordForemanWakeEvent } from './foreman-notification.service'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_auth/access', () => ({ memberActor: vi.fn(), visibleSpaceIds: vi.fn() }))
vi.mock('@rerun/cloud/email', () => ({ pushNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/foreman/conversation', () => ({ setForemanConversationStatus: vi.fn(async () => {}) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: vi.fn() }))

const ENGINE = { workspaceId: 7, isSandbox: false }

type Insert = { table: string; row: Record<string, unknown> }
let inserts: Insert[]
let conversation: { id: string } | null
let prefs: unknown

function fakeClient() {
    return {
        from: (table: string) => ({
            insert: (row: Record<string, unknown>) => {
                inserts.push({ table, row })
                const result = table === 'foreman_conversations' ? { data: { id: 'conv-1' }, error: null } : { data: null, error: null }
                return { select: () => ({ single: async () => result }), then: (resolve: (value: unknown) => void) => resolve(result) }
            },
        }),
    }
}

const event = (over: Partial<NotificationPayload> = {}): NotificationPayload => ({
    event: 'agent.notification',
    kind: 'approval',
    agentId: 'foreman',
    sessionId: 'wake-1',
    runId: 'run-1',
    message: 'Reconnect Gmail for Scout',
    metadata: { memberId: 'member-1', toolName: 'request_approval' },
    source: 'wake',
    timestamp: '2026-11-16T10:00:00Z',
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    inserts = []
    conversation = null
    prefs = null
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeClient() as never)
    vi.mocked(memberActor).mockResolvedValue({ kind: 'user', userId: 'member-1', workspaceId: 7, role: 'admin', boxScope: 'all' })
    vi.mocked(visibleSpaceIds).mockResolvedValue('all')
    vi.mocked(selectMaybeSingle).mockImplementation(async (_client, table) => (table === 'foreman_conversations' ? { data: conversation } : { data: { email_notification_prefs: prefs } }) as never)
})

describe('recordForemanWakeEvent', () => {
    it('opens a conversation for the member, files the card and pushes it', async () => {
        await recordForemanWakeEvent(ENGINE, event())
        expect(inserts.map(insert => insert.table)).toEqual(['foreman_conversations', 'notifications'])
        expect(inserts[0].row).toMatchObject({ workspace_id: 7, user_id: 'member-1', backend: 'engine', engine_session_id: 'wake-1', kind: 'thread' })
        expect(inserts[1].row).toMatchObject({ agent_id: null, engine_agent_id: 'foreman', kind: 'approval', source: 'wake', recipients: { 'member-1': 'mine' } })
        expect(setForemanConversationStatus).toHaveBeenCalledWith(7, 'wake-1', 'awaiting_approval')
        expect(pushNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentId: 'foreman', conversationId: 'conv-1', recipients: { 'member-1': 'mine' } }))
    })

    // Most wakes end in silence, and silence leaves nothing anywhere.
    it('leaves no trace of a wake that said nothing', async () => {
        await recordForemanWakeEvent(ENGINE, event({ event: 'agent.message.completed', kind: 'done', message: 'Message completed', metadata: { memberId: 'member-1', status: 'done' } }))
        expect(inserts).toEqual([])
        expect(pushNotification).not.toHaveBeenCalled()
    })

    it('files the note a wake ended on as something to read', async () => {
        await recordForemanWakeEvent(ENGINE, event({ event: 'agent.message.completed', kind: 'done', message: 'x', metadata: { memberId: 'member-1', status: 'done', finalText: 'Scout failed three times on Gmail: it needs a new sign-in.' } }))
        expect(inserts[1].row).toMatchObject({ kind: 'info', message: 'Scout failed three times on Gmail: it needs a new sign-in.' })
        expect(setForemanConversationStatus).toHaveBeenCalledWith(7, 'wake-1', 'awaiting_ack')
    })

    it('reuses the conversation a card of the same wake already opened', async () => {
        conversation = { id: 'conv-0' }
        await recordForemanWakeEvent(ENGINE, event({ kind: 'info', metadata: { memberId: 'member-1' } }))
        expect(inserts.map(insert => insert.table)).toEqual(['notifications'])
        expect(pushNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ conversationId: 'conv-0' }))
    })

    it('never announces an error, and settles the conversation it opened', async () => {
        await recordForemanWakeEvent(ENGINE, event({ event: 'agent.message.completed', kind: 'error', message: 'Message failed', metadata: { memberId: 'member-1', status: 'error' } }))
        expect(inserts).toEqual([])
        expect(setForemanConversationStatus).toHaveBeenCalledWith(7, 'wake-1', 'idle')
    })

    // With the box's key a process could name anyone: the member is read back from the workspace.
    it('ignores a member who left, one who sees only some Boxes, and an event naming nobody', async () => {
        vi.mocked(memberActor).mockResolvedValueOnce(null)
        await recordForemanWakeEvent(ENGINE, event())
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['box-a']))
        await recordForemanWakeEvent(ENGINE, event())
        await recordForemanWakeEvent(ENGINE, event({ metadata: { toolName: 'request_approval' } }))
        expect(inserts).toEqual([])
    })

    it('respects a member who muted the Chief of Staff', async () => {
        prefs = { version: 2, coworkers: { foreman: { mode: 'muted' } } }
        await recordForemanWakeEvent(ENGINE, event())
        expect(inserts.map(insert => insert.table)).toEqual(['foreman_conversations'])
        expect(pushNotification).not.toHaveBeenCalled()
    })

    it('pushes nothing from a sandbox', async () => {
        await recordForemanWakeEvent({ workspaceId: 7, isSandbox: true }, event())
        expect(pushNotification).not.toHaveBeenCalled()
    })
})
