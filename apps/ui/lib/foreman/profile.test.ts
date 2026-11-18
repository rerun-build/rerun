import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { fakeSupabase } from '@/test/supabase-fake'
import { readAnswers, writeAnswers } from './profile'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/naming.service', () => ({ ensureWorkspaceNamed: vi.fn() }))

function context(db: ReturnType<typeof fakeSupabase>): WorkspaceContext {
    return { userId: 'member-2', userEmail: null, userLocale: null, authUser: {} as WorkspaceContext['authUser'], workspace: { id: 7 } as WorkspaceContext['workspace'], role: 'admin', boxScope: 'all', supabase: db.client }
}

describe('foreman profile', () => {
    it('reads the answers of the workspace, whoever asks', async () => {
        const db = fakeSupabase(table => (table === 'workspace_onboarding' ? { data: { answers: { company_name: 'Acme' } } } : undefined))

        await expect(readAnswers(context(db))).resolves.toEqual({ company_name: 'Acme' })
        expect(db.chainsOn('users')).toEqual([])
        expect(db.chainsOn('workspace_onboarding')[0]).toContainEqual(expect.objectContaining({ method: 'eq', args: ['workspace_id', 7] }))
    })

    it('writes the answers on the workspace and leaves the person alone', async () => {
        const db = fakeSupabase()

        await writeAnswers(context(db), { company_name: 'Acme' }, false)

        expect(db.writes('workspace_onboarding')).toEqual([expect.objectContaining({ method: 'upsert', payload: expect.objectContaining({ workspace_id: 7, answers: { company_name: 'Acme' } }) })])
        expect(db.writes('workspaces')).toEqual([])
        expect(db.writes('users')).toEqual([])
    })

    it('stamps the workspace onboarded once, never over an earlier date', async () => {
        const db = fakeSupabase()

        await writeAnswers(context(db), {}, true)

        const [stamp] = db.writes('workspaces')
        expect(stamp.payload).toEqual({ onboarded_at: expect.any(String) })
        expect(stamp.filters).toEqual(
            expect.arrayContaining([expect.objectContaining({ method: 'eq', args: ['id', 7] }), expect.objectContaining({ method: 'is', args: ['onboarded_at', null] })]),
        )
    })
})
