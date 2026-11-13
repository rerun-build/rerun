import { describe, expect, it, vi } from 'vitest'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn() }))

const { foremanConversationOf } = await import('./conversation')

const row = { id: 'row-1', kind: 'thread' as const, title: null, status: 'working' as const, first_message: 'Connect Gmail to Nora', engine_session_id: 'engine-1', created_at: '2026-11-13T09:00:00.000Z', updated_at: '2026-11-13T10:00:00.000Z' }

describe('foremanConversationOf', () => {
    it('reads a thread the way a coworker conversation reads, placed by when it opened', () => {
        expect(foremanConversationOf({ ...row, title: 'Gmail for Nora' })).toMatchObject({ id: 'row-1', agentId: 'foreman', title: 'Gmail for Nora', status: 'working', kind: 'thread', createdAt: '2026-11-13T09:00:00.000Z', firstMessage: 'Connect Gmail to Nora', engineSessionId: 'engine-1' })
    })

    it('names a thread after what it opened with until its title is written', () => {
        expect(foremanConversationOf(row).title).toBe('Connect Gmail to Nora')
    })

    it('always calls General by its name, whatever its row was titled before it became General', () => {
        expect(foremanConversationOf({ ...row, kind: 'general', title: 'Weekly revenue report', first_message: null }).title).toBe('General')
    })
})
