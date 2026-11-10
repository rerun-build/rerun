import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { visibleSpaceIds } from '@/app/api/_auth/access'
import { markSessionsHandled } from '@/app/api/_services/conversation.service'
import { createClient } from '@/supabase/server'
import { selectCount, selectMany } from '@/supabase/supabase-helpers'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listWorkspaceInbox, markInboxRead } from './inbox.service'

vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(), selectCount: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/i18n/recipient-locale', () => ({ recipientLocale: vi.fn(async () => 'en') }))
vi.mock('@/app/api/_services/conversation.service', () => ({ markSessionsHandled: vi.fn() }))
vi.mock('@/app/api/_auth/access', async importOriginal => {
    const actual = await importOriginal<typeof import('@/app/api/_auth/access')>()
    return { ...actual, visibleSpaceIds: vi.fn(actual.visibleSpaceIds) }
})

const ctx = { userId: 'me', role: 'admin', boxScope: 'all', supabase: {}, workspace: { id: 7 } } as unknown as WorkspaceContext

function unseenRun(sessionId: string, lastAt: string, extra: Partial<{ source: string; slug: string | null; run_count: number }> = {}) {
    return { session_id: sessionId, agent_id: 'a', title: `${sessionId} title`, source: 'dashboard', slug: null, message: `${sessionId} done`, last_at: lastAt, run_count: 1, ...extra }
}

function callerReturning(unseen: unknown[]) {
    const db = fakeSupabase(table => (table === 'rpc:unseen_runs' ? { data: unseen } : undefined))
    vi.mocked(createClient).mockResolvedValue(db.client as never)
    return db
}

describe('listWorkspaceInbox', () => {
    beforeEach(() => vi.clearAllMocks())

    it('lists the waiting conversations with their message, then the unseen runs folded by scheduled task', async () => {
        callerReturning([
            unseenRun('s-cron-2', '2026-10-22T10:00:00Z', { source: 'schedule', slug: 'digest', run_count: 2 }),
            unseenRun('s-chat', '2026-10-22T09:00:00Z'),
            unseenRun('s-cron-1', '2026-10-22T08:00:00Z', { source: 'schedule', slug: 'digest' }),
        ])
        vi.mocked(selectMany)
            .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Scout' }], error: null } as never)
            .mockResolvedValueOnce({ data: [{ id: 's-ask', agent_id: 'a', engine_session_id: 'e-ask', title: 'Leads', status: 'awaiting_question', updated_at: '2026-10-22T11:00:00Z' }, { id: 's-other', agent_id: 'a', engine_session_id: 'e-other', title: 'Theirs', status: 'awaiting_approval', updated_at: '2026-10-22T10:30:00Z' }], error: null } as never)
            .mockResolvedValueOnce({ data: [{ agent_id: 'a', engine_session_id: 'e-ask', kind: 'question', message: ' Which list? ', metadata: null, recipients: { me: 'mine' } }, { agent_id: 'a', engine_session_id: 'e-other', kind: 'approval', message: 'Send it?', metadata: null, recipients: { someone: 'mine' } }], error: null } as never)
        vi.mocked(selectCount).mockResolvedValueOnce({ data: 2, error: null } as never)

        const inbox = await listWorkspaceInbox(ctx)

        expect(inbox.running).toBe(2)
        expect(inbox.items).toEqual([
            { id: 's-ask', sessionId: 's-ask', sessionIds: ['s-ask'], agentId: 'a', agentName: 'Scout', status: 'awaiting_question', title: 'Leads', message: 'Which list?', updatedAt: '2026-10-22T11:00:00Z', count: 1 },
            { id: 'done:a:schedule:digest', sessionId: 's-cron-2', sessionIds: ['s-cron-2', 's-cron-1'], agentId: 'a', agentName: 'Scout', status: 'done', title: 'digest', message: null, updatedAt: '2026-10-22T10:00:00.000Z', count: 3 },
            { id: 'done:s-chat', sessionId: 's-chat', sessionIds: ['s-chat'], agentId: 'a', agentName: 'Scout', status: 'done', title: 's-chat title', message: 's-chat done', updatedAt: '2026-10-22T09:00:00.000Z', count: 1 },
        ])
    })

    it("leaves out what happens in a Box the member does not reach, a finished run included", async () => {
        callerReturning([{ ...unseenRun('s-hidden', '2026-10-22T10:00:00Z'), agent_id: 'hidden' }])
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['open']))
        vi.mocked(selectMany)
            .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Scout', space_id: 'open' }, { id: 'hidden', name: 'Closer', space_id: 'closed' }], error: null } as never)
            .mockResolvedValueOnce({ data: [], error: null } as never)
        vi.mocked(selectCount).mockResolvedValueOnce({ data: 0, error: null } as never)

        const inbox = await listWorkspaceInbox({ ...ctx, role: 'member' } as WorkspaceContext)

        expect(inbox.items).toEqual([])
        expect(vi.mocked(selectMany).mock.calls[1][3]).toMatchObject({ agent_id: ['a'] })
    })

    it('answers empty without reading further when the workspace has no coworker', async () => {
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [], error: null } as never)

        expect(await listWorkspaceInbox(ctx)).toEqual({ items: [], running: 0 })
        expect(createClient).not.toHaveBeenCalled()
    })
})

describe('markInboxRead', () => {
    beforeEach(() => vi.clearAllMocks())

    it('clears the waiting conversations and records the given ones as seen by the caller', async () => {
        const db = callerReturning([])

        await markInboxRead(ctx, ['s1', 's2'])

        expect(markSessionsHandled).toHaveBeenCalledWith(ctx, ['s1', 's2'])
        expect(db.writes('session_reads')[0].payload).toEqual([
            { session_id: 's1', user_id: 'me' },
            { session_id: 's2', user_id: 'me' },
        ])
    })

    it('records every unseen run on all', async () => {
        const db = callerReturning([unseenRun('s-chat', '2026-10-22T09:00:00Z')])

        await markInboxRead(ctx, 'all')

        expect(markSessionsHandled).toHaveBeenCalledWith(ctx, 'all')
        expect(db.writes('session_reads')[0].payload).toEqual([{ session_id: 's-chat', user_id: 'me' }])
    })
})
