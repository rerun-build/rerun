import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: vi.fn(async () => null) }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), getSessionMessages: vi.fn(async () => []) }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { engineSessionOf, findForemanGeneral, foremanConversationOf, ForemanGeneralAlreadyOpenError, listForemanConversations, listTeamForemanConversations, readTeamForemanTranscript, setForemanConversationStatus, startEngineConversation, touchForemanConversation } = await import('./conversation')
const { getWorkspaceConnection } = await import('@/app/api/_services/workspace-engine.service')
const { getSessionMessages } = await import('@/lib/engine/client')

const CHIEF = 'chief-of-staff-row'
const ctx = { userId: 'user-1', workspace: { id: 7 } } as unknown as WorkspaceContext

const row = { id: 'row-1', kind: 'thread' as const, title: 'Connect Gmail to Nora', status: 'working' as const, first_message: 'Connect Gmail to Nora', engine_session_id: 'engine-1', created_at: '2026-11-13T09:00:00.000Z', updated_at: '2026-11-13T10:00:00.000Z' }

function eq(calls: readonly SupabaseCall[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

// Rows matching every `eq` of the read, one of them for a `.maybeSingle()`.
function matching(rows: Record<string, unknown>[], calls: readonly SupabaseCall[]) {
    const found = rows.filter(found => calls.every(call => call.method !== 'eq' || found[call.args[0] as string] === call.args[1]))
    return { data: calls.some(call => call.method === 'maybeSingle' || call.method === 'single') ? (found[0] ?? null) : found }
}

describe('foremanConversationOf', () => {
    it('reads a thread the way a coworker conversation reads, placed by when it opened', () => {
        expect(foremanConversationOf({ ...row, title: 'Gmail for Nora' })).toMatchObject({ id: 'row-1', agentId: 'foreman', title: 'Gmail for Nora', status: 'working', kind: 'thread', createdAt: '2026-11-13T09:00:00.000Z', firstMessage: 'Connect Gmail to Nora', engineSessionId: 'engine-1' })
    })

    it('always calls General by its name, whatever its row was titled before it became General', () => {
        expect(foremanConversationOf({ ...row, kind: 'general', title: 'Weekly revenue report', first_message: null }).title).toBe('General')
    })
})

describe('the conversations of a member with the Chief of Staff', () => {
    let db: FakeSupabase
    let sessions: Record<string, unknown>[]
    let hubRows: Record<string, unknown>[]
    let insertError: { code: string; message: string } | null

    beforeEach(() => {
        sessions = []
        hubRows = []
        insertError = null
        db = fakeSupabase((table, calls) => {
            if (table === 'rpc:ensure_foreman_agent') return { data: CHIEF }
            if (table === 'sessions' && writeMethodOf(calls) === 'insert') return { error: insertError }
            if (table === 'sessions' && !writeMethodOf(calls)) return matching(sessions, calls)
            if (table === 'foreman_conversations' && !writeMethodOf(calls)) return matching(hubRows, calls)
            return undefined
        })
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    })

    it('opens a thread in sessions, on the Chief of Staff row, owned by whoever writes', async () => {
        await startEngineConversation(ctx, 'thread-1', 'engine-9', 'Hire me a writer for the blog', 'thread')

        const [write] = db.writes('sessions')
        expect(write.method).toBe('insert')
        expect(write.payload).toMatchObject({ id: 'thread-1', agent_id: CHIEF, owner_id: 'user-1', engine_session_id: 'engine-9', kind: 'thread', status: 'working', source: 'dashboard', title: 'Hire me a writer for the blog', first_message: 'Hire me a writer for the blog' })
        expect(db.writes('foreman_conversations')).toHaveLength(0)
    })

    it('opens General with its name and no opening line', async () => {
        await startEngineConversation(ctx, 'general-1', 'engine-9', 'hello', 'general')

        expect(db.writes('sessions')[0].payload).toMatchObject({ kind: 'general', title: 'General', first_message: null })
    })

    it('hands back the General another tab opened a moment before', async () => {
        insertError = { code: '23505', message: 'duplicate key' }
        sessions = [{ id: 'general-0', engine_session_id: 'engine-0', agent_id: CHIEF, owner_id: 'user-1', kind: 'general' }]

        const attempt = startEngineConversation(ctx, 'general-1', 'engine-9', 'hello', 'general')

        await expect(attempt).rejects.toBeInstanceOf(ForemanGeneralAlreadyOpenError)
        await expect(attempt).rejects.toMatchObject({ general: { id: 'general-0', engineSessionId: 'engine-0' } })
    })

    it('lists only the conversations the member owns', async () => {
        sessions = [
            { ...row, agent_id: CHIEF, owner_id: 'user-1' },
            { ...row, id: 'row-2', agent_id: CHIEF, owner_id: 'user-2' },
        ]

        const listed = await listForemanConversations(ctx)

        expect(listed.map(conversation => conversation.id)).toEqual(['row-1'])
        const [read] = db.chainsOn('sessions')
        expect([eq(read, 'agent_id'), eq(read, 'owner_id')]).toEqual([CHIEF, 'user-1'])
    })

    it('finds the member General among the Chief of Staff sessions', async () => {
        sessions = [{ id: 'general-0', engine_session_id: 'engine-0', agent_id: CHIEF, owner_id: 'user-1', kind: 'general' }]

        await expect(findForemanGeneral(ctx)).resolves.toEqual({ id: 'general-0', engineSessionId: 'engine-0' })
    })

    it('tells an engine conversation from the onboarding one kept on the hub, and refuses another member', async () => {
        sessions = [{ id: 'mine', engine_session_id: 'engine-1', agent_id: CHIEF, owner_id: 'user-1' }, { id: 'theirs', engine_session_id: 'engine-2', agent_id: CHIEF, owner_id: 'user-2' }]
        hubRows = [{ id: 'onboarding', workspace_id: 7, user_id: 'user-1', backend: 'hub' }]

        await expect(engineSessionOf(ctx, 'mine')).resolves.toEqual({ backend: 'engine', engineSessionId: 'engine-1' })
        await expect(engineSessionOf(ctx, 'onboarding')).resolves.toEqual({ backend: 'hub', engineSessionId: null })
        await expect(engineSessionOf(ctx, 'theirs')).resolves.toBeNull()
    })

    it('moves a conversation forward on every turn, never a coworker one', async () => {
        await touchForemanConversation('thread-1')

        const [write] = db.writes('sessions')
        expect(write.payload).toMatchObject({ status: 'working' })
        expect(write.filters.map(call => [call.method, ...call.args])).toEqual([
            ['eq', 'id', 'thread-1'],
            ['not', 'owner_id', 'is', null],
        ])
    })

    it('sets where a run stopped on the Chief of Staff session of that engine session, keeping an acknowledgement', async () => {
        await setForemanConversationStatus(7, 'engine-1', 'idle')

        const [write] = db.writes('sessions')
        expect(write.payload).toEqual({ status: 'idle' })
        expect(write.filters.map(call => [call.method, ...call.args])).toEqual([
            ['eq', 'agent_id', CHIEF],
            ['eq', 'engine_session_id', 'engine-1'],
            ['neq', 'status', 'awaiting_ack'],
        ])
    })
})

describe('what an admin reads of the other members\' conversations', () => {
    const admin = { ...ctx, role: 'admin' } as unknown as WorkspaceContext
    const member = { ...ctx, role: 'member' } as unknown as WorkspaceContext

    // Reads filter with `eq` and `in`: the owners still in the workspace are an `in`.
    function filtered(rows: Record<string, unknown>[], calls: readonly SupabaseCall[]) {
        return rows.filter(found =>
            calls.every(call => {
                if (call.method === 'eq') return found[call.args[0] as string] === call.args[1]
                if (call.method === 'in') return (call.args[1] as unknown[]).includes(found[call.args[0] as string])
                return true
            })
        )
    }

    beforeEach(() => {
        const sessions = [
            { ...row, id: 'mine', agent_id: CHIEF, owner_id: 'user-1' },
            { ...row, id: 'hers', agent_id: CHIEF, owner_id: 'user-2', engine_session_id: 'engine-hers' },
            { ...row, id: 'gone', agent_id: CHIEF, owner_id: 'user-left' },
            { ...row, id: 'coworker', agent_id: 'coworker-row', owner_id: null },
        ]
        const members = [
            { user_id: 'user-1', workspace_id: 7 },
            { user_id: 'user-2', workspace_id: 7 },
        ]
        const db = fakeSupabase((table, calls) => {
            if (table === 'rpc:ensure_foreman_agent') return { data: CHIEF }
            if (table === 'workspace_members') return { data: filtered(members, calls) }
            if (table === 'sessions' && !writeMethodOf(calls)) return { data: filtered(sessions, calls) }
            return undefined
        })
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(getWorkspaceConnection).mockResolvedValue({ baseUrl: 'http://engine', apiKey: 'key' } as never)
        vi.mocked(getSessionMessages).mockClear()
    })

    it("lists the other members' conversations to an admin, never their own nor a member who left", async () => {
        const listed = await listTeamForemanConversations(admin)
        expect(listed.map(conversation => [conversation.id, conversation.ownerId])).toEqual([['hers', 'user-2']])
    })

    it('shows a member nobody else\'s', async () => {
        expect(await listTeamForemanConversations(member)).toEqual([])
        expect(await readTeamForemanTranscript(member, 'hers')).toBeNull()
    })

    it('reads only a conversation that list holds', async () => {
        expect(await readTeamForemanTranscript(admin, 'mine')).toBeNull()
        expect(await readTeamForemanTranscript(admin, 'gone')).toBeNull()
        expect(await readTeamForemanTranscript(admin, 'hers')).toEqual([])
        expect(getSessionMessages).toHaveBeenCalledTimes(1)
        expect(vi.mocked(getSessionMessages).mock.calls[0].slice(1)).toEqual(['foreman', 'engine-hers'])
    })
})
