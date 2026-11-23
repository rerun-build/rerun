import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn() }))

const { copyToShippedForemanRow } = await import('./conversation')

const session = {
    id: 'conv-1',
    owner_user_id: 'ana',
    engine_session_id: 'engine-1',
    kind: 'thread',
    title: 'Invoices',
    status: 'idle',
    first_message: 'Look at the invoices',
    created_at: '2026-11-23T09:00:00.000Z',
    updated_at: '2026-11-23T10:00:00.000Z',
    agent: { workspace_id: 7, kind: 'foreman' },
}

describe('copyToShippedForemanRow', () => {
    beforeEach(() => {
        state.db = fakeSupabase(table => (table === 'sessions' ? { data: session } : undefined))
    })

    it('adds the copy when it is missing, and changes only a copy of the same member and workspace', async () => {
        await copyToShippedForemanRow('conv-1')

        const [insert, update] = state.db!.writes('foreman_conversations')
        expect(insert).toMatchObject({ method: 'upsert', payload: { id: 'conv-1', workspace_id: 7, user_id: 'ana', backend: 'engine', status: 'idle' } })
        expect(state.db!.chainsOn('foreman_conversations')[0].find(call => call.method === 'upsert')?.args[1]).toEqual({ onConflict: 'id', ignoreDuplicates: true })
        expect(update.method).toBe('update')
        expect(update.payload).not.toHaveProperty('user_id')
        expect(update.payload).not.toHaveProperty('workspace_id')
        expect(update.filters.map(call => call.args)).toEqual([
            ['id', 'conv-1'],
            ['workspace_id', 7],
            ['user_id', 'ana'],
            ['backend', 'engine'],
        ])
    })
})
