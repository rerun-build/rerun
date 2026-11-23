import { assertAgentAccess, assertSessionInWorkspace, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { AuthorizationError, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { createSessionRow, getSessionEngineContext, lastRunError, listSessionRuns, readUsageSeed, resolveAgentTarget, updateSessionStatus } from '@/app/api/_services/chat.service'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import { cancelRun, getSession, getSessionMessages, listRuns, listSessions, listSkillProposals } from '@/lib/engine/client'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adoptEngineSession, cancelSessionRuns, finalizeSession, listAgentConversations, listAgentSessions, listPendingCards, listAgentThreads, listWorkspaceConversationOverview, markSessionsHandled, readSessionSnapshot, renameSession, searchWorkspaceConversations, SESSION_HISTORY_LIMIT, THREAD_FEED_LIMIT } from './conversation.service'
import { EMPTY_SESSION_SNAPSHOT } from '@/lib/chat/session-snapshot'

vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: vi.fn(), selectMaybeSingle: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/i18n/recipient-locale', () => ({ recipientLocale: vi.fn(async () => 'en') }))
vi.mock('@/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', async importOriginal => {
    const actual = await importOriginal<typeof import('@/app/api/_auth/access')>()
    return { ...actual, assertAgentAccess: vi.fn(), assertSessionInWorkspace: vi.fn(), visibleSpaceIds: vi.fn(actual.visibleSpaceIds) }
})
vi.mock('@/app/api/_services/chat.service', () => ({ createSessionRow: vi.fn(), resolveAgentTarget: vi.fn(), getSessionEngineContext: vi.fn(), updateSessionStatus: vi.fn(), lastRunError: vi.fn(), listSessionRuns: vi.fn(), readUsageSeed: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ cancelRun: vi.fn(), getSession: vi.fn(), getSessionMessages: vi.fn(), listRuns: vi.fn(), listSessions: vi.fn(), listSkillProposals: vi.fn() }))
vi.mock('@/lib/chat/engine-history', () => ({ transformEngineMessages: vi.fn() }))

const ctx = { userId: 'admin', role: 'admin', boxScope: 'all', supabase: {}, workspace: { id: 7 } } as unknown as WorkspaceContext
const memberCtx = { ...ctx, userId: 'member', role: 'member' } as WorkspaceContext
const adminActor: Actor = { kind: 'user', userId: 'admin', workspaceId: 7, role: 'admin', boxScope: 'all' }
const reached = (agent = { workspace_id: 7, space_id: 'space-1', engine_agent_id: 'engine-agent' }) => ({ actor: adminActor, access: 'manage' as const, agent })

function session(agentId: string, id: string, updatedAt: string, status = 'idle') {
    return { id, agent_id: agentId, title: `${id} title`, status, updated_at: updatedAt, created_at: updatedAt, engine_session_id: `engine-${id}`, source: 'dashboard', kind: 'thread' }
}

type Preview = { agent_id: string; session_id: string | null; title: string | null; status: string | null; updated_at: string | null; last_message: string | null; last_message_from: string | null; last_message_at: string | null; last_message_author_id: string | null }

function preview(agentId: string, sessionId: string, updatedAt: string, status = 'idle', last: Partial<Preview> = {}): Preview {
    return { agent_id: agentId, session_id: sessionId, title: `${sessionId} title`, status, updated_at: updatedAt, last_message: null, last_message_from: null, last_message_at: null, last_message_author_id: null, ...last }
}

const quiet = (agentId: string): Preview => ({ agent_id: agentId, session_id: null, title: null, status: null, updated_at: null, last_message: null, last_message_from: null, last_message_at: null, last_message_author_id: null })

const rpc = vi.fn()

// The previews come from the caller's `coworker_previews`; selectMany answers in order: the agents, the
// pending count, the Generals, then the engine ids and sources of the latest conversations.
function answers(agents: { id: string }[], previews: Preview[], pending: { agent_id: string }[], generals: { id: string; agent_id: string }[] = []) {
    rpc.mockResolvedValueOnce({ data: previews, error: null })
    vi.mocked(createClient).mockResolvedValue({ rpc } as never)
    const details = previews.flatMap(row => (row.session_id ? [{ id: row.session_id, engine_session_id: `engine-${row.session_id}`, source: 'dashboard' }] : []))
    vi.mocked(selectMany)
        .mockResolvedValueOnce({ data: agents, error: null } as never)
        .mockResolvedValueOnce({ data: pending, error: null } as never)
        .mockResolvedValueOnce({ data: generals, error: null } as never)
        .mockResolvedValueOnce({ data: details, error: null } as never)
}

describe('listWorkspaceConversationOverview', () => {
    beforeEach(() => vi.clearAllMocks())

    it('keeps the latest conversation of each agent, read once per coworker', async () => {
        answers([{ id: 'a' }, { id: 'b' }], [preview('a', 's3', '2026-09-18T10:00:00Z'), preview('b', 's2', '2026-09-17T10:00:00Z')], [])

        const overview = await listWorkspaceConversationOverview(ctx)

        expect(overview.map(row => [row.agentId, row.latest?.id, row.latest?.engineSessionId])).toEqual([
            ['a', 's3', 'engine-s3'],
            ['b', 's2', 'engine-s2'],
        ])
        expect(rpc).toHaveBeenCalledWith('coworker_previews', { p_workspace_id: 7 })
        expect(vi.mocked(selectMany).mock.calls[3][3]).toEqual({ id: ['s3', 's2'] })
    })

    it('reports an agent nobody has talked to with a null latest', async () => {
        answers([{ id: 'a' }, { id: 'quiet' }], [preview('a', 's1', '2026-09-18T10:00:00Z'), quiet('quiet')], [])

        const overview = await listWorkspaceConversationOverview(ctx)

        expect(overview.find(row => row.agentId === 'quiet')).toEqual({ agentId: 'quiet', latest: null, pending: 0, generalSessionId: null })
    })

    // The Home says "You:" to the member who wrote the last message, never to their teammates.
    it('carries the last thing said, marked as the caller\'s own only when they wrote it', async () => {
        answers(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
            [
                preview('a', 's1', '2026-09-18T10:00:00Z', 'idle', { last_message: 'Send it', last_message_from: 'user', last_message_author_id: 'admin' }),
                preview('b', 's2', '2026-09-18T10:00:00Z', 'idle', { last_message: 'Send it', last_message_from: 'user', last_message_author_id: 'teammate' }),
                preview('c', 's3', '2026-09-18T10:00:00Z', 'idle', { last_message: 'Done, sent.', last_message_from: 'agent' }),
                preview('d', 's4', '2026-09-18T10:00:00Z'),
            ],
            []
        )

        const overview = await listWorkspaceConversationOverview(ctx)

        expect(overview.map(row => row.latest?.lastMessage)).toEqual([{ text: 'Send it', mine: true }, { text: 'Send it', mine: false }, { text: 'Done, sent.', mine: false }, null])
    })

    // The app opens a coworker on its General, whichever conversation moved last.
    it('names each coworker\'s General, read for the coworkers alone', async () => {
        answers([{ id: 'a' }, { id: 'b' }], [preview('a', 'thread-1', '2026-09-18T10:00:00Z'), quiet('b')], [], [{ id: 'general-a', agent_id: 'a' }])

        const overview = await listWorkspaceConversationOverview(ctx)

        expect(overview.map(row => [row.agentId, row.latest?.id ?? null, row.generalSessionId])).toEqual([
            ['a', 'thread-1', 'general-a'],
            ['b', null, null],
        ])
        expect(vi.mocked(selectMany).mock.calls[2][3]).toEqual({ agent_id: ['a', 'b'], kind: 'general' })
    })

    it('counts the pending conversations per agent', async () => {
        answers([{ id: 'a' }, { id: 'b' }], [preview('a', 's1', '2026-09-18T10:00:00Z', 'awaiting_question'), quiet('b')], [{ agent_id: 'a' }, { agent_id: 'a' }, { agent_id: 'b' }])

        const overview = await listWorkspaceConversationOverview(ctx)

        expect(overview.map(row => row.pending)).toEqual([2, 1])
    })

    it('asks only for the agents of this workspace, and never touches a Box', async () => {
        answers([{ id: 'a' }], [preview('a', 's1', '2026-09-18T10:00:00Z')], [])

        await listWorkspaceConversationOverview(ctx)

        expect(vi.mocked(selectMany).mock.calls[0][3]).toEqual({ workspace_id: 7, kind: 'coworker' })
        expect(vi.mocked(selectMany).mock.calls[1][3]).toMatchObject({ agent_id: ['a'] })
    })

    it('leaves out the coworkers of a Box the member does not reach, without asking for their conversations', async () => {
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['open']))
        answers([{ id: 'a', space_id: 'open' }, { id: 'hidden', space_id: 'closed' }] as never, [preview('a', 's1', '2026-09-18T10:00:00Z'), preview('hidden', 's9', '2026-09-19T10:00:00Z')], [])

        const overview = await listWorkspaceConversationOverview(memberCtx)

        expect(overview.map(row => row.agentId)).toEqual(['a'])
        expect(vi.mocked(selectMany).mock.calls[1][3]).toMatchObject({ agent_id: ['a'] })
        expect(vi.mocked(selectMany).mock.calls[3][3]).toEqual({ id: ['s1'] })
    })

    it('does not query anything else when the workspace has no agent', async () => {
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [], error: null } as never)

        expect(await listWorkspaceConversationOverview(ctx)).toEqual([])
        expect(selectMany).toHaveBeenCalledTimes(1)
        expect(rpc).not.toHaveBeenCalled()
    })
})

describe('listPendingCards', () => {
    beforeEach(() => vi.clearAllMocks())

    const memberActor: Actor = { kind: 'user', userId: 'member', workspaceId: 7, role: 'member', boxScope: 'assigned' }
    const conn = { baseUrl: 'https://engine.test', apiKey: null }
    const question = { role: 'assistant', parts: [{ type: 'text', text: 'Which tone?' }, { type: 'tool-ask_user', toolCallId: 'call-q', state: 'input-available', input: { questions: [{ question: 'Which tone?', options: ['Formal', 'Casual'] }] } }] }

    it("reads the cards of the coworkers the member reaches, each with what it asks, as that member", async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue({} as never)
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['open']))
        vi.mocked(selectMany)
            .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Writer', space_id: 'open' }, { id: 'hidden', name: 'Hidden', space_id: 'closed' }], error: null } as never)
            .mockResolvedValueOnce({ data: [{ id: 's1', agent_id: 'a', title: 'Newsletter', status: 'awaiting_question', updated_at: '2026-11-20T10:00:00Z' }], error: null } as never)
        vi.mocked(getSessionEngineContext).mockResolvedValue({ agentId: 'a', conn, engineAgentId: 'engine-a', engineSessionId: 'engine-s1' })
        vi.mocked(getSessionMessages).mockResolvedValue([] as never)
        vi.mocked(transformEngineMessages).mockReturnValue([question] as never)
        vi.mocked(listSkillProposals).mockResolvedValue([])

        const cards = await listPendingCards(memberActor)

        expect(vi.mocked(selectMany).mock.calls[1][3]).toEqual({ agent_id: ['a'], status: ['awaiting_question', 'awaiting_approval', 'awaiting_connector'] })
        expect(getSessionEngineContext).toHaveBeenCalledWith('s1', memberActor)
        expect(cards).toEqual([{ sessionId: 's1', agentId: 'a', agentName: 'Writer', title: 'Newsletter', status: 'awaiting_question', updatedAt: '2026-11-20T10:00:00Z', peek: expect.objectContaining({ pending: expect.objectContaining({ kind: 'question', toolCallId: 'call-q' }), ask: 'Which tone?' }) }])
    })

    it('leaves out a card it could not read rather than failing the whole list', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue({} as never)
        vi.mocked(selectMany)
            .mockResolvedValueOnce({ data: [{ id: 'a', name: 'Writer', space_id: null }], error: null } as never)
            .mockResolvedValueOnce({ data: [{ id: 's1', agent_id: 'a', title: 'Gone', status: 'awaiting_approval', updated_at: '2026-11-20T10:00:00Z' }], error: null } as never)
        vi.mocked(getSessionEngineContext).mockRejectedValue(new Error('engine away'))

        expect(await listPendingCards(adminActor)).toEqual([])
    })
})

describe('finalizeSession', () => {
    beforeEach(() => vi.clearAllMocks())

    // RER-78: a stream reconnection that settles after the run ended on a question card used to write
    // `idle` over the `awaiting_question` the hub had just written, and the card vanished.
    it.each(['idle', 'error'] as const)('a settled reconnection only moves a session still working, to %s', async status => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)

        await finalizeSession('s1', status, { onlyWhileWorking: true })

        expect(updateSessionStatus).not.toHaveBeenCalled()
        const [write] = db.writes('sessions')
        expect(write.payload).toEqual({ status })
        expect(write.filters.map(call => call.args)).toEqual([
            ['id', 's1'],
            ['status', 'working'],
        ])
    })

    it('a stop or a closed card still ends the conversation whatever its status', async () => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)

        await finalizeSession('s1', 'idle')

        expect(updateSessionStatus).toHaveBeenCalledWith('s1', 'idle')
        expect(db.writes('sessions')).toEqual([])
    })
})

describe('markSessionsHandled', () => {
    beforeEach(() => vi.clearAllMocks())

    it('only clears conversations of the workspace agents, even when a foreign session id is passed', async () => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ id: 'a' }, { id: 'b' }], error: null } as never)

        await markSessionsHandled(ctx, ['own-session', 'foreign-session'])

        expect(vi.mocked(selectMany).mock.calls[0][3]).toEqual({ workspace_id: 7, kind: 'coworker' })
        const [write] = db.writes('sessions')
        expect(write.payload).toEqual({ status: 'idle' })
        expect(write.filters.map(call => call.args)).toEqual([
            ['agent_id', ['a', 'b']],
            ['status', expect.arrayContaining(['awaiting_question', 'awaiting_approval', 'awaiting_connector'])],
            ['id', ['own-session', 'foreign-session']],
        ])
    })

    it('clears every waiting conversation of the workspace on all, without an id filter', async () => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ id: 'a' }], error: null } as never)

        await markSessionsHandled(ctx, 'all')

        expect(db.writes('sessions')[0].filters.map(call => call.args[0])).toEqual(['agent_id', 'status'])
    })

    it("never clears a conversation of a coworker outside the member's Boxes, even on all", async () => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['open']))
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ id: 'a', space_id: 'open' }, { id: 'hidden', space_id: 'closed' }], error: null } as never)

        await markSessionsHandled(memberCtx, 'all')

        expect(db.writes('sessions')[0].filters[0].args).toEqual(['agent_id', ['a']])
    })

    it('writes nothing when the workspace has no agent', async () => {
        const db = fakeSupabase()
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [], error: null } as never)

        await markSessionsHandled(ctx, ['foreign-session'])

        expect(db.writes('sessions')).toHaveLength(0)
    })
})

describe('renameSession', () => {
    beforeEach(() => vi.clearAllMocks())

    function sessions(renamed: { id: string }[] = [{ id: 'session-1' }]) {
        const db = fakeSupabase(() => ({ data: renamed }))
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        vi.mocked(assertSessionInWorkspace).mockResolvedValue({ id: 'session-1', agent_id: 'a', engine_session_id: 'engine-1', engine_agent_id: 'engine-agent', updated_at: '2026-11-19T08:00:00Z' })
        return db
    }

    it('writes the name without the spaces around it, on a thread only', async () => {
        const db = sessions()

        expect(await renameSession('session-1', '  Pipeline, week 46  ')).toBe(true)

        const [write] = db.writes('sessions')
        expect(write.payload).toEqual({ title: 'Pipeline, week 46' })
        expect(write.filters.map(call => call.args)).toEqual([['id', 'session-1'], ['kind', 'thread'], ['id']])
    })

    it('cuts a name longer than a title can be', async () => {
        const db = sessions()

        await renameSession('session-1', 'x'.repeat(200))

        expect(db.writes('sessions')[0].payload).toEqual({ title: 'x'.repeat(80) })
    })

    it('refuses a blank name before reading anything', async () => {
        const db = sessions()

        expect(await renameSession('session-1', '   ')).toBe(false)

        expect(assertSessionInWorkspace).not.toHaveBeenCalled()
        expect(db.writes('sessions')).toEqual([])
    })

    it('says no when the row is General, which the write leaves untouched', async () => {
        sessions([])

        expect(await renameSession('session-1', 'Mine')).toBe(false)
    })

    it('writes nothing on a conversation the caller does not reach', async () => {
        const db = sessions()
        vi.mocked(assertSessionInWorkspace).mockRejectedValue(new AuthorizationError('sessionNotFound'))

        await expect(renameSession('foreign-session', 'Mine')).rejects.toBeInstanceOf(AuthorizationError)

        expect(db.writes('sessions')).toEqual([])
    })
})

describe('cancelSessionRuns', () => {
    beforeEach(() => vi.clearAllMocks())

    const conn = { url: 'http://box', key: 'k' }

    it('cancels every running run of the conversation, and only those', async () => {
        vi.mocked(getSessionEngineContext).mockResolvedValue({ conn, engineAgentId: 'engine-agent', engineSessionId: 'es-1' } as never)
        vi.mocked(listRuns).mockResolvedValue([
            { id: 'r1', sessionId: 'es-1', status: 'running' },
            { id: 'r2', sessionId: 'es-1', status: 'completed' },
            { id: 'r3', sessionId: 'es-2', status: 'running' },
            { id: 'r4', sessionId: 'es-1', status: 'running' },
        ] as never)
        vi.mocked(cancelRun).mockResolvedValue(undefined as never)

        await cancelSessionRuns('session-1')

        expect(vi.mocked(cancelRun).mock.calls.map(call => call[2])).toEqual(['r1', 'r4'])
    })

    it('keeps going when one cancellation fails', async () => {
        vi.mocked(getSessionEngineContext).mockResolvedValue({ conn, engineAgentId: 'engine-agent', engineSessionId: 'es-1' } as never)
        vi.mocked(listRuns).mockResolvedValue([
            { id: 'r1', sessionId: 'es-1', status: 'running' },
            { id: 'r2', sessionId: 'es-1', status: 'running' },
        ] as never)
        vi.mocked(cancelRun).mockRejectedValueOnce(new Error('box down')).mockResolvedValueOnce(undefined as never)

        await expect(cancelSessionRuns('session-1')).resolves.toBeUndefined()
        expect(cancelRun).toHaveBeenCalledTimes(2)
    })

    it('does not reach the Box for a conversation it cannot resolve', async () => {
        vi.mocked(getSessionEngineContext).mockResolvedValue(null as never)

        await cancelSessionRuns('session-1')

        expect(listRuns).not.toHaveBeenCalled()
    })
})

describe('adoptEngineSession', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase().client)
        vi.mocked(assertAgentAccess).mockResolvedValue(reached())
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: {}, engineAgentId: 'engine-agent' } as never)
        vi.mocked(createSessionRow).mockResolvedValue('new-session' as never)
    })

    it('returns the existing mirror row without asking the Box', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValueOnce({ data: { id: 'mirrored' }, error: null } as never)

        await expect(adoptEngineSession('agent-1', 'es-1', 'Title')).resolves.toBe('mirrored')
        expect(listSessions).not.toHaveBeenCalled()
        expect(createSessionRow).not.toHaveBeenCalled()
    })

    it('mirrors no session the Box does not hold for this agent', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValueOnce({ data: null, error: null } as never)
        vi.mocked(getSession).mockResolvedValue(null as never)
        vi.mocked(listSessions).mockResolvedValue([] as never)

        await expect(adoptEngineSession('agent-1', 'someone-elses-session', 'Title')).rejects.toThrow('Conversation not found')
        expect(createSessionRow).not.toHaveBeenCalled()
    })

    it('refuses an agent from another workspace before any read', async () => {
        vi.mocked(assertAgentAccess).mockRejectedValueOnce(new Error('Agent not found'))

        await expect(adoptEngineSession('agent-1', 'es-1', 'Title')).rejects.toThrow('Agent not found')
        expect(selectMaybeSingle).not.toHaveBeenCalled()
    })

    it('resolves the origin agent within the workspace only', async () => {
        vi.mocked(selectMaybeSingle)
            .mockResolvedValueOnce({ data: null, error: null } as never)
            .mockResolvedValueOnce({ data: { id: 'origin-agent' }, error: null } as never)
        vi.mocked(getSession).mockResolvedValue({ id: 'es-1', originAgentId: 'engine-origin', source: 'agent' } as never)

        await expect(adoptEngineSession('agent-1', 'es-1', 'Title')).resolves.toBe('new-session')

        expect(assertAgentAccess).toHaveBeenCalledWith('agent-1', 'use', undefined)
        expect(resolveAgentTarget).toHaveBeenCalledWith('agent-1', adminActor)
        expect(listSessions).not.toHaveBeenCalled()

        expect(vi.mocked(selectMaybeSingle).mock.calls[1][1]).toBe('agents')
        expect(vi.mocked(selectMaybeSingle).mock.calls[1][3]).toEqual({ engine_agent_id: 'engine-origin', workspace_id: 7 })
        expect(createSessionRow).toHaveBeenCalledWith('agent-1', 'es-1', 'Title', 'origin-agent', 'agent')
    })

    it('adopts a session with no origin agent without looking one up', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValueOnce({ data: null, error: null } as never)
        vi.mocked(getSession).mockResolvedValue(null)
        vi.mocked(listSessions).mockResolvedValue([{ id: 'es-1', source: 'dashboard' }] as never)

        await adoptEngineSession('agent-1', 'es-1', 'Title')

        expect(selectMaybeSingle).toHaveBeenCalledTimes(1)
        expect(createSessionRow).toHaveBeenCalledWith('agent-1', 'es-1', 'Title', null, 'dashboard')
    })
})

describe('readSessionSnapshot', () => {
    const conn = { url: 'http://box', key: 'k' }
    const lastDone = { id: 'r1', sessionId: 'es-1', status: 'done' }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getSessionEngineContext).mockResolvedValue({ conn, engineAgentId: 'engine-agent', engineSessionId: 'es-1' } as never)
        vi.mocked(getSessionMessages).mockResolvedValue([{ id: 'm1' }] as never)
        vi.mocked(transformEngineMessages).mockReturnValue([{ id: 'h1' }] as never)
        vi.mocked(listSkillProposals).mockResolvedValue([{ id: 'p1' }] as never)
    })

    it('answers the whole conversation from one resolution of the session', async () => {
        vi.mocked(listSessionRuns).mockResolvedValue({ latest: lastDone, lastDone, running: { id: 'r2' } } as never)
        vi.mocked(readUsageSeed).mockResolvedValue({ usage: { inputTokens: 3 }, provider: 'claude' } as never)
        vi.mocked(lastRunError).mockReturnValue(null)

        await expect(readSessionSnapshot('session-1')).resolves.toEqual({ messages: [{ id: 'h1' }], usage: { usage: { inputTokens: 3 }, provider: 'claude' }, lastError: null, activeRunId: 'r2', proposals: [{ id: 'p1' }] })
        expect(getSessionEngineContext).toHaveBeenCalledTimes(1)
        expect(readUsageSeed).toHaveBeenCalledWith(conn, 'engine-agent', lastDone)
    })

    it('keeps the transcript when the runs cannot be read', async () => {
        vi.mocked(listSessionRuns).mockRejectedValue(new Error('box down'))
        vi.mocked(lastRunError).mockReturnValue(null)

        const snapshot = await readSessionSnapshot('session-1')

        expect(snapshot.messages).toEqual([{ id: 'h1' }])
        expect(snapshot.usage).toBeNull()
        expect(snapshot.activeRunId).toBeNull()
        expect(readUsageSeed).not.toHaveBeenCalled()
    })

    it('answers an empty conversation for a session not on the engine yet', async () => {
        vi.mocked(getSessionEngineContext).mockResolvedValue({ conn, engineAgentId: 'engine-agent', engineSessionId: null } as never)

        await expect(readSessionSnapshot('session-1')).resolves.toBe(EMPTY_SESSION_SNAPSHOT)
        expect(getSessionMessages).not.toHaveBeenCalled()
    })
})

describe('searchWorkspaceConversations', () => {
    beforeEach(() => vi.clearAllMocks())

    function found(agents: { id: string }[], rows: ReturnType<typeof session>[]) {
        vi.mocked(selectMany)
            .mockResolvedValueOnce({ data: agents, error: null } as never)
            .mockResolvedValueOnce({ data: rows, error: null } as never)
    }

    it('reads nothing for an empty query across the workspace', async () => {
        expect(await searchWorkspaceConversations(ctx, '  ')).toEqual([])
        expect(selectMany).not.toHaveBeenCalled()
    })

    it("matches titles literally, newest first, within the workspace's agents", async () => {
        found([{ id: 'a' }, { id: 'b' }], [session('a', 's1', '2026-09-18T10:00:00Z')])

        const hits = await searchWorkspaceConversations(ctx, '100%_off')

        expect(vi.mocked(selectMany).mock.calls[1].slice(3)).toEqual([{ agent_id: ['a', 'b'], title: { ilike: '%100  off%' } }, { column: 'updated_at', ascending: false }, 20])
        expect(hits).toEqual([{ id: 's1', agentId: 'a', title: 's1 title', status: 'idle', updatedAt: '2026-09-18T10:00:00Z' }])
    })

    it("lists an agent's latest conversations when nothing is typed", async () => {
        found([{ id: 'a' }, { id: 'b' }], [])

        await searchWorkspaceConversations(ctx, '', 'b')

        expect(vi.mocked(selectMany).mock.calls[1].slice(3)).toEqual([{ agent_id: ['b'] }, { column: 'updated_at', ascending: false }, 8])
    })

    it("finds nothing on a coworker of a Box the member does not reach, without reading its conversations", async () => {
        vi.mocked(visibleSpaceIds).mockResolvedValueOnce(new Set(['open']))
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ id: 'a', space_id: 'open' }, { id: 'hidden', space_id: 'closed' }], error: null } as never)

        expect(await searchWorkspaceConversations(memberCtx, 'report', 'hidden')).toEqual([])
        expect(selectMany).toHaveBeenCalledTimes(1)
    })

    it('finds nothing on an agent of another workspace, without reading its conversations', async () => {
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ id: 'a' }], error: null } as never)

        expect(await searchWorkspaceConversations(ctx, 'report', 'elsewhere')).toEqual([])
        expect(selectMany).toHaveBeenCalledTimes(1)
    })
})

type HistoryRow = ReturnType<typeof session> & Record<string, unknown>

// The history reads, routed by what they ask for: the newest threads, the General, the engine ids
// already mirrored, and the notifications of the waiting ones.
function history({ threads = [], general = [], mirrored = [], notifications = [] }: { threads?: HistoryRow[]; general?: HistoryRow[]; mirrored?: string[]; notifications?: unknown[] }) {
    vi.mocked(selectMany).mockImplementation((async (_client: unknown, table: string, _columns: unknown, filters: Record<string, unknown>) => {
        if (table === 'notifications') return { data: notifications, error: null }
        if (filters.kind === 'general') return { data: general, error: null }
        if (filters.engine_session_id) return { data: mirrored.filter(id => (filters.engine_session_id as string[]).includes(id)).map(engine_session_id => ({ engine_session_id })), error: null }
        return { data: threads, error: null }
    }) as never)
}

const historyCall = (match: (filters: Record<string, unknown>) => boolean) => vi.mocked(selectMany).mock.calls.find(call => call[1] === 'sessions' && match(call[3] as Record<string, unknown>))

const minutesAgo = (minutes: number) => new Date(Date.parse('2026-11-23T12:00:00Z') - minutes * 60_000).toISOString()

describe('listAgentSessions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(assertAgentAccess).mockResolvedValue(reached())
        vi.mocked(createServiceRoleClient).mockReturnValue({} as never)
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: {}, engineAgentId: 'engine-agent' } as never)
        vi.mocked(listSessions).mockResolvedValue([])
    })

    const fullPageOf = (source: string) => Array.from({ length: SESSION_HISTORY_LIMIT }, (_, i) => ({ ...session('a', `${source}-${i}`, minutesAgo(i)), source }))
    const engineSession = (id: string, updatedAt: string, originAgentId: string | null = 'engine-peer') => ({ id, title: `${id} title`, status: 'open', source: originAgentId ? 'agent' : 'dashboard', originAgentId, createdAt: updatedAt, updatedAt })

    it('reads the newest threads in order with a limit, and the General apart', async () => {
        history({ threads: [session('a', 't1', minutesAgo(5))], general: [{ ...session('a', 'g', minutesAgo(9000)), kind: 'general' }] })

        const { entries } = await listAgentSessions('a', adminActor)

        expect(historyCall(f => f.kind === 'thread')?.slice(3)).toEqual([{ agent_id: 'a', kind: 'thread', source: undefined }, { column: 'updated_at', ascending: false }, SESSION_HISTORY_LIMIT])
        expect(entries.map(e => [e.id, e.kind])).toEqual([
            ['t1', 'thread'],
            ['g', 'general'],
        ])
    })

    it('asks the table for the sources of the filter, and leaves the General out of a filtered list', async () => {
        history({})

        await listAgentSessions('a', adminActor, 'automations')
        expect(historyCall(f => f.kind === 'thread')?.[3]).toMatchObject({ source: ['schedule', 'trigger'] })

        vi.mocked(selectMany).mockClear()
        await listAgentSessions('a', adminActor, 'chats')
        expect(historyCall(f => f.kind === 'thread')?.[3]).toMatchObject({ source: ['dashboard', 'builder', 'delegate', 'api'] })
        expect(historyCall(f => f.kind === 'general')).toBeUndefined()
    })

    it('does not bring back as engine-only the conversations of other coworkers whose row is past the page (RER-282)', async () => {
        const fromPeers = Array.from({ length: 300 }, (_, i) => engineSession(`peer-${i}`, minutesAgo(i * 2)))
        history({ threads: fullPageOf('schedule'), mirrored: fromPeers.map(s => s.id) })
        vi.mocked(listSessions).mockResolvedValue(fromPeers as never)

        const { entries } = await listAgentSessions('a', adminActor)

        expect(entries.filter(e => e.id === null)).toEqual([])
        expect(entries).toHaveLength(SESSION_HISTORY_LIMIT)
    })

    it('still lists a conversation another coworker opened that has no row yet, inside the window of a full page', async () => {
        history({ threads: fullPageOf('schedule'), mirrored: [] })
        vi.mocked(listSessions).mockResolvedValue([engineSession('fresh', minutesAgo(1)), engineSession('too-old', minutesAgo(SESSION_HISTORY_LIMIT + 50)), engineSession('mine', minutesAgo(1), null)] as never)

        const { entries } = await listAgentSessions('a', adminActor)

        expect(entries.filter(e => e.id === null).map(e => e.engineSessionId)).toEqual(['fresh'])
        expect(entries).toHaveLength(SESSION_HISTORY_LIMIT)
    })

    it('leaves the engine-only conversations of other coworkers out of the automations', async () => {
        history({})
        vi.mocked(listSessions).mockResolvedValue([engineSession('fresh', minutesAgo(1))] as never)

        expect((await listAgentSessions('a', adminActor, 'automations')).entries).toEqual([])
    })

    it('asks the Box only for a filter that can keep a conversation another coworker opened', async () => {
        history({})

        await listAgentSessions('a', adminActor, 'automations')
        expect(resolveAgentTarget).not.toHaveBeenCalled()
        expect(listSessions).not.toHaveBeenCalled()

        await listAgentSessions('a', adminActor, 'all')
        expect(resolveAgentTarget).toHaveBeenCalledTimes(1)
        expect(listSessions).toHaveBeenCalledTimes(1)
    })

    it('keeps the conversations other coworkers opened out of Chats, and in All (RER-125)', async () => {
        history({})
        vi.mocked(listSessions).mockResolvedValue([engineSession('fresh', minutesAgo(1))] as never)

        expect((await listAgentSessions('a', adminActor, 'chats')).entries).toEqual([])
        expect(listSessions).not.toHaveBeenCalled()
        expect((await listAgentSessions('a', adminActor, 'all')).entries.map(e => e.engineSessionId)).toEqual(['fresh'])
    })

    it('reads the next page up to its cursor, without the General again', async () => {
        const before = minutesAgo(250)
        history({ threads: [session('a', 'older', minutesAgo(300))], general: [{ ...session('a', 'g', minutesAgo(9000)), kind: 'general' }] })

        const page = await listAgentSessions('a', adminActor, 'all', before)

        expect(historyCall(f => f.kind === 'thread')?.[3]).toMatchObject({ updated_at: { lte: before } })
        expect(historyCall(f => f.kind === 'general')).toBeUndefined()
        expect(page).toEqual({ entries: [expect.objectContaining({ id: 'older' })], before: null })
    })

    it('points to the oldest thread it returns while older ones may remain', async () => {
        history({ threads: fullPageOf('schedule') })
        expect((await listAgentSessions('a', adminActor)).before).toBe(minutesAgo(SESSION_HISTORY_LIMIT - 1))

        history({ threads: [session('a', 't1', minutesAgo(5))] })
        expect((await listAgentSessions('a', adminActor)).before).toBeNull()
    })

    it('points before the thread a conversation another coworker opened pushed out of the page', async () => {
        history({ threads: fullPageOf('schedule'), mirrored: [] })
        vi.mocked(listSessions).mockResolvedValue([engineSession('fresh', minutesAgo(1))] as never)

        const page = await listAgentSessions('a', adminActor)

        expect(page.entries.map(e => e.engineSessionId)).not.toContain('engine-schedule-199')
        expect(page.before).toBe(minutesAgo(SESSION_HISTORY_LIMIT - 2))
    })

    it('past the first page, lists the conversations another coworker opened in its window that have no row yet', async () => {
        history({ threads: [session('a', 'older', minutesAgo(150))], mirrored: ['adopted'] })
        vi.mocked(listSessions).mockResolvedValue([engineSession('newer', minutesAgo(50)), engineSession('adopted', minutesAgo(120)), engineSession('lone', minutesAgo(130))] as never)

        const { entries } = await listAgentSessions('a', adminActor, 'all', minutesAgo(100))

        expect(entries.filter(e => e.id === null).map(e => e.engineSessionId)).toEqual(['lone'])
    })
})

describe('listAgentConversations', () => {
    const asMember = { ...ctx, userId: 'me' } as WorkspaceContext

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(assertAgentAccess).mockResolvedValue(reached())
        vi.mocked(resolveAgentTarget).mockRejectedValue(new Error('no box'))
        vi.mocked(createServiceRoleClient).mockReturnValue({} as never)
    })

    function unseenRuns(result: { data: { session_id: string; agent_id: string }[] | null; error: unknown }) {
        vi.mocked(createClient).mockResolvedValue({ rpc: vi.fn().mockResolvedValue(result) } as never)
    }

    it('marks a conversation whose run finished since the last read, for this agent only', async () => {
        history({ threads: [session('a', 's1', '2026-10-26T10:00:00Z'), session('a', 's2', '2026-10-25T10:00:00Z')] })
        unseenRuns({ data: [{ session_id: 's1', agent_id: 'a' }, { session_id: 's2', agent_id: 'b' }], error: null })

        const conversations = await listAgentConversations(asMember, 'a')

        expect(conversations.map(c => [c.id, c.unseen])).toEqual([
            ['s1', true],
            ['s2', false],
        ])
    })

    it('says what a waiting conversation asks, from the notification that flipped it', async () => {
        history({
            threads: [session('a', 's1', '2026-10-26T10:00:00Z', 'awaiting_approval'), session('a', 's2', '2026-10-25T10:00:00Z')],
            notifications: [{ agent_id: 'a', engine_session_id: 'engine-s1', kind: 'approval', message: ' Send the email to Malt? ', metadata: null, recipients: { me: 'mine' } }],
        })
        unseenRuns({ data: [], error: null })

        const conversations = await listAgentConversations(asMember, 'a')

        expect(conversations.map(c => [c.id, c.ask])).toEqual([
            ['s1', 'Send the email to Malt?'],
            ['s2', null],
        ])
        expect(vi.mocked(selectMany).mock.calls.find(call => call[1] === 'notifications')?.[3]).toEqual({ agent_id: { in: ['a'] }, engine_session_id: { in: ['engine-s1'] }, kind: { neq: 'done' } })
    })

    it('leaves unseen out rather than failing when the read state cannot be fetched', async () => {
        history({ threads: [session('a', 's1', '2026-10-26T10:00:00Z')] })
        unseenRuns({ data: null, error: new Error('rpc down') })

        const [conversation] = await listAgentConversations(asMember, 'a')

        expect(conversation).not.toHaveProperty('unseen')
        expect(vi.mocked(selectMany).mock.calls.some(call => call[1] === 'notifications')).toBe(false)
    })

    it('keeps the General for the app even when it is older than every thread of the page', async () => {
        history({ threads: Array.from({ length: SESSION_HISTORY_LIMIT }, (_, i) => session('a', `t${i}`, minutesAgo(i))), general: [{ ...session('a', 'g', '2026-01-01T00:00:00Z'), kind: 'general' }] })
        unseenRuns({ data: [], error: null })

        const conversations = await listAgentConversations(asMember, 'a')

        expect(conversations.find(c => c.kind === 'general')?.id).toBe('g')
    })
})

describe('listAgentThreads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(assertAgentAccess).mockResolvedValue(reached())
        vi.mocked(createServiceRoleClient).mockReturnValue({} as never)
    })

    it('reads the newest threads of the coworker from Supabase alone, General left out', async () => {
        vi.mocked(selectMany).mockResolvedValueOnce({ data: [{ ...session('a', 's2', '2026-11-08T10:00:00Z'), automation_name: 'Daily check', outcome: 'done', origin_agent_id: null, first_message: 'Check the funnel' }], error: null } as never)

        const threads = await listAgentThreads('a', adminActor)

        expect(assertAgentAccess).toHaveBeenCalledWith('a', 'use', adminActor)
        expect(vi.mocked(selectMany).mock.calls[0].slice(3)).toEqual([{ agent_id: 'a', kind: 'thread' }, { column: 'created_at', ascending: false }, THREAD_FEED_LIMIT])
        expect(vi.mocked(resolveAgentTarget)).not.toHaveBeenCalled()
        expect(threads).toEqual([{ id: 's2', title: 's2 title', status: 'idle', source: 'dashboard', createdAt: '2026-11-08T10:00:00Z', updatedAt: '2026-11-08T10:00:00Z', originAgentId: null, automationName: 'Daily check', outcome: 'done', firstMessage: 'Check the funnel' }])
    })

    it('exposes the kind and the opening time of every conversation in the history', async () => {
        vi.mocked(resolveAgentTarget).mockRejectedValue(new Error('no box'))
        history({ general: [{ ...session('a', 'g', '2026-11-08T10:00:00Z'), kind: 'general' }] })
        vi.mocked(createClient).mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never)

        const conversations = await listAgentConversations({ ...ctx, userId: 'me' } as WorkspaceContext, 'a')

        expect(conversations.map(c => [c.id, c.kind, c.createdAt])).toEqual([['g', 'general', '2026-11-08T10:00:00Z']])
    })

    it('gives the app what a thread opened with, so General shows it as the web does', async () => {
        vi.mocked(resolveAgentTarget).mockRejectedValue(new Error('no box'))
        history({ threads: [{ ...session('a', 't', '2026-11-08T10:00:00Z'), first_message: 'Plan the posts' }] })
        vi.mocked(createClient).mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never)

        const conversations = await listAgentConversations({ ...ctx, userId: 'me' } as WorkspaceContext, 'a')

        expect(conversations.map(c => c.firstMessage)).toEqual(['Plan the posts'])
    })
})
