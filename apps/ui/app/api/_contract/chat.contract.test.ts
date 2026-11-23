import { CONTRACT_WORKSPACE, callRoute, contractContext, contractSessionUser, expectContract } from '@/test/mobile-contract'
import { ENGINE_SESSION_NOT_FOUND, FOREMAN_AGENT_ID, mobileApi } from '@rerun/contracts'
import { createUIMessageStream, createUIMessageStreamResponse, simulateReadableStream, type UIMessage, type UIMessageChunk } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { forgetMachine } from '@/lib/engine/engine-memory'
import type { EngineMessage, EngineRun } from '@/lib/engine/types'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase, type SupabaseResolver } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Partial<Tables[T]['Row']>
type ModelStreamPart = Awaited<ReturnType<MockLanguageModelV3['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never

// The chats of the app: a coworker's, the Chief of Staff's on the engine, and the onboarding the hub
// ran itself for older builds. These routes write their own Response, so nothing checks them at
// runtime: this file is the only guard. The services run for real on a fake database; the engine,
// the model and the pool are what is replaced.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null, poolHasRoom: true, model: null as MockLanguageModelV3 | null }))

const engine = vi.hoisted(() => ({
    chat: vi.fn<typeof import('@/lib/engine/client').chat>(),
    reconnectRun: vi.fn<typeof import('@/lib/engine/client').reconnectRun>(),
    cancelRun: vi.fn<typeof import('@/lib/engine/client').cancelRun>(),
    getSessionMessages: vi.fn<typeof import('@/lib/engine/client').getSessionMessages>(),
    listRuns: vi.fn<typeof import('@/lib/engine/client').listRuns>(),
    listSkillProposals: vi.fn<typeof import('@/lib/engine/client').listSkillProposals>(),
    getRunSteps: vi.fn<typeof import('@/lib/engine/client').getRunSteps>(),
    // The box's /health is not part of the conversation under test.
    supportsForemanVault: vi.fn(async () => false),
}))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ ...state.db?.client, auth: { getUser: async () => ({ data: { user: state.ctx?.authUser } }) } }),
    getRequestAccessToken: async () => 'token',
}))
vi.mock('@/supabase/session/getServerSession', async importOriginal => {
    const original = await importOriginal<typeof import('@/supabase/session/getServerSession')>()
    return {
        ...original,
        getAuthUser: async () => state.ctx?.authUser,
        getSessionWorkspace: async (): ReturnType<typeof original.getSessionWorkspace> => {
            const ctx = state.ctx!
            return { supabase: ctx.supabase, user: contractSessionUser(ctx.userId, ctx.workspace.id), workspaceRefused: false, membership: { role: ctx.role, box_scope: ctx.boxScope } }
        },
    }
})
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), ...engine }))
vi.mock('@/lib/services/embed', () => ({ embedTextShared: async () => null }))
vi.mock('@/lib/ai/generate-title', () => ({ generateSessionTitle: async () => 'Bakeries to call' }))
vi.mock('@rerun/cloud/phone.server', () => ({ isPhoneStepPending: async () => false, phoneOwnerId: async () => ({ userId: null }) }))
vi.mock('@rerun/cloud/engines', () => ({
    claimPoolEngine: async () => ({ ok: false, error: 'The pool is empty', raced: false }),
    desktopRelayBase: async () => null,
    DESKTOP_DIRECT: true,
    requestBoxRestore: async () => {},
    restartManagedEngine: async () => {},
    poolHasRoom: async () => state.poolHasRoom,
}))
vi.mock('@rerun/cloud/billing.server', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/billing.server')>()), logRerunUsage: async () => {}, meteredFetch: () => fetch }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: () => () => state.model }))

type AgentRow = Row<'agents'> & { space: Pick<Tables['spaces']['Row'], 'visibility'> }
type SessionRow = Row<'sessions'> & { agent: Pick<Tables['agents']['Row'], 'workspace_id' | 'space_id' | 'engine_agent_id'> & Partial<Pick<Tables['agents']['Row'], 'kind'>> }

const agents: (AgentRow | Row<'agents'>)[] = [
    { id: 'agent-scout', name: 'Scout', kind: 'coworker', workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'eng-scout', disabled_at: null, disabled_reason: null, created_at: '2026-11-02T09:05:00.000Z', space: { visibility: 'workspace' } },
    { id: 'agent-cos', name: 'Chief of Staff', kind: 'foreman', workspace_id: 7, space_id: null, engine_agent_id: FOREMAN_AGENT_ID, disabled_at: null, disabled_reason: null, created_at: '2026-11-02T09:00:00.000Z' },
]
const foremanAgent = { workspace_id: 7, space_id: null, engine_agent_id: FOREMAN_AGENT_ID, kind: 'foreman' as const }
const spaces: Row<'spaces'>[] = [{ id: 'space-sales', workspace_id: 7, name: 'Sales', visibility: 'workspace', created_at: '2026-11-02T09:00:00.000Z' }]
const sessions: SessionRow[] = [
    { id: '5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10', agent_id: 'agent-scout', engine_session_id: 'eng-session-1', kind: 'general', title: 'General', status: 'idle', agent: { workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'eng-scout' } },
    { id: '9c2e7a41-6d3b-4f80-b1a5-7e4d2c9f0a83', agent_id: 'agent-ledger', engine_session_id: 'eng-session-9', kind: 'thread', title: 'Invoices', status: 'idle', agent: { workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'eng-ledger' } },
    { id: 'fm-general', agent_id: 'agent-cos', owner_user_id: 'user-ada', engine_session_id: 'eng-fm-1', kind: 'general', title: 'General', status: 'idle', updated_at: '2026-11-18T16:00:00.000Z', agent: foremanAgent },
    { id: 'fm-thread', agent_id: 'agent-cos', owner_user_id: 'user-ada', engine_session_id: 'eng-fm-2', kind: 'thread', title: 'Quarterly plan', status: 'idle', updated_at: '2026-11-17T10:00:00.000Z', agent: foremanAgent },
]
const coworkerSessions = sessions.filter(session => session.agent_id !== 'agent-cos')
const engine_pool: Row<'engine_pool'>[] = [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }]
const foreman_conversations: Row<'foreman_conversations'>[] = []
const workspace_onboarding: Row<'workspace_onboarding'>[] = [{ workspace_id: 7, answers: { company_name: 'Atelier Nord', foreman: { language: 'en' } } }]

const tables = { agents, spaces, sessions, engine_pool, foreman_conversations, workspace_onboarding, space_members: [], workspaces: [{ id: 7, waitlisted_at: null, boxes_archived_at: null }] }

// A write answers its payload, with the id the database gives a new conversation.
function withNewSessionId(read: SupabaseResolver): SupabaseResolver {
    return (table, calls) => (table === 'sessions' && writeMethodOf(calls) === 'insert' ? { data: { id: 'session-new' } } : read(table, calls))
}

function seed(overrides: Partial<Record<keyof typeof tables, readonly object[]>> = {}, ctx: Partial<WorkspaceContext> = {}) {
    forgetMachine(7)
    const db = fakeSupabase(withNewSessionId(tableResolver({ ...tables, ...overrides })))
    state.db = db
    state.ctx = contractContext(db, ctx)
    return db
}

// A turn as the engine streams it: reasoning, a tool call with its input and its output, a progress
// part of its own, then the answer. Built the way the engine builds it (apps/engine/src/runtime/stream.ts).
const ENGINE_TURN: UIMessageChunk[] = [
    { type: 'start', messageId: 'msg-reply-1' },
    { type: 'start-step' },
    { type: 'reasoning-start', id: 'reasoning-1' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'The CRM lists the bakeries already called.' },
    { type: 'reasoning-end', id: 'reasoning-1' },
    { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'web_search' },
    { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'web_search', input: { query: 'artisan bakeries Lyon 7e' } },
    { type: 'tool-output-available', toolCallId: 'call-1', output: { results: [{ title: 'Maison Pozzoli', url: 'https://maisonpozzoli.fr' }] } },
    { type: 'finish-step' },
    { type: 'data-compaction', id: 'checkpoint-1', data: { status: 'done', messagesCompacted: 12, tokensRecovered: 8400 } },
    { type: 'start-step' },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'Three bakeries ' },
    { type: 'text-delta', id: 'text-1', delta: 'have not been called yet.' },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
]

function engineTurn(sessionId: string, runId: string): Response {
    const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => ENGINE_TURN.forEach(chunk => writer.write(chunk)) }) })
    response.headers.set('x-session-id', sessionId)
    response.headers.set('x-run-id', runId)
    return response
}

function engineReplay(): Response {
    const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => ENGINE_TURN.forEach(chunk => writer.write(chunk)) }) })
    return new Response(response.body, { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } })
}

const engineBusy = (authorId: string | null) => Response.json({ error: 'a run is already in flight on this session', code: 'run_in_flight', runId: 'run-7', sessionId: 'eng-session-1', startedAt: '2026-11-19T08:59:30.000Z', authorId }, { status: 409 })

function answerOf(chunks: unknown): { text: string; types: string[] } {
    const list = chunks as UIMessageChunk[]
    return { text: list.flatMap(chunk => (chunk.type === 'text-delta' ? [chunk.delta] : [])).join(''), types: list.map(chunk => chunk.type) }
}

const transcript: EngineMessage[] = [
    { id: 'm1', sessionId: 'eng-fm-1', role: 'user', contentJson: JSON.stringify([{ type: 'text', text: 'Which coworker should handle the invoices?' }]), toolCallsJson: null, authorId: 'user-ada', createdAt: '2026-11-18T15:58:00.000Z' },
    { id: 'm2', sessionId: 'eng-fm-1', role: 'assistant', contentJson: JSON.stringify([{ type: 'tool-call', toolCallId: 'call-9', toolName: 'list_agents', input: {} }]), toolCallsJson: null, authorId: null, createdAt: '2026-11-18T15:58:04.000Z' },
    { id: 'm3', sessionId: 'eng-fm-1', role: 'tool', contentJson: JSON.stringify([{ type: 'tool-result', toolCallId: 'call-9', toolName: 'list_agents', output: { type: 'json', value: [{ name: 'Ledger' }] } }]), toolCallsJson: null, authorId: null, createdAt: '2026-11-18T15:58:05.000Z' },
    { id: 'm4', sessionId: 'eng-fm-1', role: 'assistant', contentJson: JSON.stringify([{ type: 'text', text: 'Ledger already reads your invoices.' }]), toolCallsJson: null, authorId: null, createdAt: '2026-11-18T15:58:09.000Z' },
]

const finishedRun: EngineRun = {
    id: 'run-41',
    agentId: FOREMAN_AGENT_ID,
    sessionId: 'eng-fm-1',
    status: 'done',
    stepCount: 2,
    usageJson: null,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    triggerSource: 'chat',
    triggerSlug: null,
    costMicros: 4200,
    inputTokens: 18200,
    outputTokens: 310,
    cachedInputTokens: 16000,
    reasoningTokens: 0,
    totalTokens: 18510,
    startedAt: '2026-11-18T15:58:01.000Z',
    finishedAt: '2026-11-18T15:58:10.000Z',
    error: null,
}

describe('a coworker chat', () => {
    beforeEach(() => {
        seed()
        engine.chat.mockReset().mockImplementation(async () => engineTurn('eng-session-1', 'run-8'))
        engine.reconnectRun.mockReset()
    })

    it('streams the answer of a conversation that goes on', async () => {
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', sessionId: '5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10', text: 'Which bakeries did we not call yet?', source: 'mobile' } })
        const answer = answerOf(await expectContract(mobileApi.sendChatMessage, res))
        expect(res.headers.get('X-Session-Id')).toBe('5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10')
        expect(res.headers.get('X-Run-Id')).toBe('run-8')
        expect(answer.text).toBe('Three bakeries have not been called yet.')
        expect(answer.types).toEqual(expect.arrayContaining(['reasoning-delta', 'tool-input-available', 'tool-output-available', 'data-compaction']))
        expect(engine.chat.mock.calls[0][2]).toMatchObject({ sessionId: 'eng-session-1', message: 'Which bakeries did we not call yet?' })
    })

    it('opens a new conversation and names the row it wrote', async () => {
        engine.chat.mockImplementation(async () => engineTurn('eng-session-2', 'run-9'))
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', text: 'Draft the follow-up email', kind: 'thread' } })
        await expectContract(mobileApi.sendChatMessage, res)
        expect(res.headers.get('X-Session-Id')).toBe('session-new')
        expect(state.db?.writes('sessions')[0]).toMatchObject({ method: 'insert', payload: { agent_id: 'agent-scout', engine_session_id: 'eng-session-2', kind: 'thread' } })
    })

    it('tails the run already answering when the same text is sent twice', async () => {
        engine.chat.mockImplementation(async () => engineBusy('user-ada'))
        engine.reconnectRun.mockImplementation(async () => engineReplay())
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', sessionId: '5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10', text: 'Which bakeries did we not call yet?' } })
        await expectContract(mobileApi.sendChatMessage, res)
        expect(res.headers.get('X-Run-Id')).toBe('run-7')
    })

    it('answers 409 run_in_flight when a teammate holds the conversation', async () => {
        engine.chat.mockImplementation(async () => engineBusy('user-grace'))
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', sessionId: '5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10', text: 'Any news?' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendChatMessage, res, 409)).toEqual({ error: 'run_in_flight', runId: 'run-7', startedAt: '2026-11-19T08:59:30.000Z', heldByTeammate: true })
    })

    it('answers 404 session_not_found when the engine lost the conversation', async () => {
        engine.chat.mockImplementation(async () => Response.json({ error: ENGINE_SESSION_NOT_FOUND }, { status: 404 }))
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', sessionId: '5b1f0c62-2f7e-4d55-9a0e-3c8a1e7d4b10', text: 'Still there?' } })
        expect(res.status).toBe(404)
        expect(await expectContract(mobileApi.sendChatMessage, res, 404)).toEqual({ error: 'session_not_found' })
    })

    it('answers 404 session_not_found for a conversation of another coworker', async () => {
        const { POST } = await import('@/app/api/chat/route')
        const res = await callRoute(POST, mobileApi.sendChatMessage, { body: { agentId: 'agent-scout', sessionId: '9c2e7a41-6d3b-4f80-b1a5-7e4d2c9f0a83', text: 'Still there?' } })
        expect(res.status).toBe(404)
        expect(await expectContract(mobileApi.sendChatMessage, res, 404)).toEqual({ error: 'session_not_found' })
        expect(engine.chat).not.toHaveBeenCalled()
    })

    it('replays a run still going when the app comes back to it', async () => {
        engine.reconnectRun.mockImplementation(async () => engineReplay())
        const { GET } = await import('@/app/api/chat/resume/route')
        const res = await callRoute(GET, mobileApi.resumeChat, { query: { agentId: 'agent-scout', runId: 'run-8' } })
        expect(answerOf(await expectContract(mobileApi.resumeChat, res)).text).toBe('Three bakeries have not been called yet.')
        expect(engine.reconnectRun).toHaveBeenCalledWith({ baseUrl: expect.any(String), apiKey: 'key' }, 'eng-scout', 'run-8')
    })

    // The registry promises a stream with a 200; a run that is over answers 204, which the AI SDK's
    // transport reads as "nothing to resume".
    it('answers 204 when the run is over', async () => {
        engine.reconnectRun.mockImplementation(async () => new Response(null, { status: 204 }))
        const { GET } = await import('@/app/api/chat/resume/route')
        const res = await callRoute(GET, mobileApi.resumeChat, { query: { agentId: 'agent-scout', runId: 'run-2' } })
        expect(res.status).toBe(204)
    })
})

describe('the Chief of Staff on the engine', () => {
    beforeEach(() => {
        seed()
        engine.chat.mockReset().mockImplementation(async () => engineTurn('eng-fm-1', 'run-42'))
        engine.reconnectRun.mockReset()
        engine.cancelRun.mockReset().mockResolvedValue()
        engine.getSessionMessages.mockReset().mockResolvedValue(transcript)
        engine.listRuns.mockReset().mockResolvedValue([finishedRun])
        engine.listSkillProposals.mockReset().mockResolvedValue([])
        engine.getRunSteps.mockReset().mockResolvedValue([
            { id: 'step-2', runId: 'run-41', agentId: FOREMAN_AGENT_ID, sessionId: 'eng-fm-1', stepNumber: 2, provider: 'anthropic', model: 'claude-sonnet-4-5', finishReason: 'stop', inputTokens: 9300, outputTokens: 120, cachedInputTokens: 8000, reasoningTokens: 0, totalTokens: 9420, toolCallCount: 0, textLength: 36, durationMs: 2400, createdAt: '2026-11-18T15:58:09.000Z' },
        ])
    })

    it('says where the workspace stands', async () => {
        const { GET } = await import('@/app/api/chat/foreman/state/route')
        expect(await expectContract(mobileApi.getForemanState, await callRoute(GET, mobileApi.getForemanState))).toMatchObject({ phase: 'companion', surface: 'engine', firstName: 'Ada', greet: false })
    })

    it('opens on General without a session id', async () => {
        const { GET } = await import('@/app/api/chat/foreman/engine/route')
        const general = (await expectContract(mobileApi.getForemanConversation, await callRoute(GET, mobileApi.getForemanConversation))) as { sessionId: string; messages: UIMessage[]; activeRunId: string | null }
        expect(general.sessionId).toBe('fm-general')
        expect(general.messages.map(message => message.role)).toEqual(['user', 'assistant', 'assistant'])
        expect(general.activeRunId).toBeNull()
    })

    it('answers null before anyone spoke in General', async () => {
        seed({ sessions: coworkerSessions })
        const { GET } = await import('@/app/api/chat/foreman/engine/route')
        expect(await expectContract(mobileApi.getForemanConversation, await callRoute(GET, mobileApi.getForemanConversation))).toBeNull()
    })

    it('opens the conversation the session id names', async () => {
        engine.listRuns.mockResolvedValue([{ ...finishedRun, id: 'run-43', sessionId: 'eng-fm-2', status: 'running', finishedAt: null }])
        const { GET } = await import('@/app/api/chat/foreman/engine/route')
        const thread = (await expectContract(mobileApi.getForemanConversation, await callRoute(GET, mobileApi.getForemanConversation, { query: { sessionId: 'fm-thread' } }))) as { sessionId: string; title: string; activeRunId: string | null }
        expect(thread).toMatchObject({ sessionId: 'fm-thread', title: 'Quarterly plan', activeRunId: 'run-43' })
        expect(engine.getSessionMessages).toHaveBeenCalledWith(expect.anything(), FOREMAN_AGENT_ID, 'eng-fm-2')
    })

    it('opens empty when the conversation cannot be read', async () => {
        engine.getSessionMessages.mockRejectedValue(new Error('fetch failed'))
        const { GET } = await import('@/app/api/chat/foreman/engine/route')
        expect(await expectContract(mobileApi.getForemanConversation, await callRoute(GET, mobileApi.getForemanConversation, { query: { sessionId: 'fm-thread' } }))).toEqual({ messages: [] })
    })

    it('streams the answer to a message in General', async () => {
        const { POST } = await import('@/app/api/chat/foreman/engine/route')
        const res = await callRoute(POST, mobileApi.sendForemanMessage, { body: { sessionId: 'fm-general', text: 'Who handles the invoices?' } })
        expect(answerOf(await expectContract(mobileApi.sendForemanMessage, res)).types).toEqual(expect.arrayContaining(['tool-output-available', 'data-compaction', 'text-delta']))
        expect(res.headers.get('X-Session-Id')).toBe('fm-general')
        expect(res.headers.get('X-Run-Id')).toBe('run-42')
        expect(engine.chat.mock.calls[0][1]).toBe(FOREMAN_AGENT_ID)
        expect(engine.chat.mock.calls[0][2]).toMatchObject({ sessionId: 'eng-fm-1', message: 'Who handles the invoices?' })
    })

    it('opens a new thread with the id the app made up', async () => {
        engine.chat.mockImplementation(async () => engineTurn('eng-fm-3', 'run-44'))
        const { POST } = await import('@/app/api/chat/foreman/engine/route')
        const res = await callRoute(POST, mobileApi.sendForemanMessage, { body: { sessionId: 'fm-new-thread', text: 'Plan the launch week', kind: 'thread' } })
        await expectContract(mobileApi.sendForemanMessage, res)
        expect(res.headers.get('X-Session-Id')).toBe('fm-new-thread')
        expect(state.db?.writes('sessions')[0]).toMatchObject({ method: 'insert', payload: { id: 'fm-new-thread', agent_id: 'agent-cos', owner_user_id: 'user-ada', engine_session_id: 'eng-fm-3', kind: 'thread' } })
    })

    it('answers 409 run_in_flight for a queued message the engine is not free for', async () => {
        vi.useFakeTimers()
        engine.chat.mockImplementation(async () => engineBusy('user-ada'))
        const { POST } = await import('@/app/api/chat/foreman/engine/route')
        const pending = callRoute(POST, mobileApi.sendForemanMessage, { body: { sessionId: 'fm-general', text: 'And the quotes?', queued: true } })
        await vi.runAllTimersAsync()
        const res = await pending
        vi.useRealTimers()
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendForemanMessage, res, 409)).toEqual({ error: 'run_in_flight', runId: 'run-7', startedAt: '2026-11-19T08:59:30.000Z', heldByTeammate: false })
    })

    it('answers 409 hub_conversation for a conversation the hub kept', async () => {
        seed({ foreman_conversations: [{ id: 'fm-onboarding', workspace_id: 7, user_id: 'user-ada', backend: 'hub', engine_session_id: null, kind: 'thread', messages: [] }] })
        const { POST } = await import('@/app/api/chat/foreman/engine/route')
        const res = await callRoute(POST, mobileApi.sendForemanMessage, { body: { sessionId: 'fm-onboarding', text: 'Hello' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendForemanMessage, res, 409)).toEqual({ error: 'hub_conversation' })
    })

    it('answers 409 foreman_unavailable when the workspace has no machine', async () => {
        seed({ engine_pool: [] })
        const { POST } = await import('@/app/api/chat/foreman/engine/route')
        const res = await callRoute(POST, mobileApi.sendForemanMessage, { body: { sessionId: 'fm-new-thread', text: 'Hello' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendForemanMessage, res, 409)).toEqual({ error: 'foreman_unavailable' })
    })

    it('stops the runs of a conversation', async () => {
        engine.listRuns.mockResolvedValue([{ ...finishedRun, id: 'run-42', status: 'running', finishedAt: null }])
        const { DELETE } = await import('@/app/api/chat/foreman/engine/route')
        await expectContract(mobileApi.stopForeman, await callRoute(DELETE, mobileApi.stopForeman, { query: { sessionId: 'fm-general', runId: 'run-42' } }))
        expect(engine.cancelRun).toHaveBeenCalledWith(expect.anything(), FOREMAN_AGENT_ID, 'run-42')
    })
})

// The onboarding the hub runs itself, still opened by iOS builds up to 36 and Android up to 5.
describe('the onboarding chat of older builds', () => {
    const onboardingWorkspace = { workspace: { ...CONTRACT_WORKSPACE, onboarded_at: null, subscription_status: null } }
    const hello: UIMessage = { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hi, I run a bakery in Lyon.' }] }

    beforeEach(() => {
        vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
        state.poolHasRoom = true
        const reply: ModelStreamPart[] = [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Nice to meet you. ' },
            { type: 'text-delta', id: 'text-1', delta: 'What takes most of your week?' },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 2100, noCache: 2100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 14, text: 14, reasoning: 0 } } },
        ]
        state.model = new MockLanguageModelV3({ provider: 'openrouter', modelId: 'openai/gpt-6-sol', doStream: async () => ({ stream: simulateReadableStream({ chunks: reply }) }) })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('reads the transcript the hub kept', async () => {
        seed({ foreman_conversations: [{ id: 'fm-onboarding', workspace_id: 7, user_id: 'user-ada', backend: 'hub', engine_session_id: null, kind: 'thread', title: 'Welcome', messages: [hello as never], updated_at: '2026-11-10T09:00:00.000Z' }] }, onboardingWorkspace)
        const { GET } = await import('@/app/api/chat/foreman/route')
        expect(await expectContract(mobileApi.getLegacyForemanConversation, await callRoute(GET, mobileApi.getLegacyForemanConversation))).toMatchObject({ sessionId: 'fm-onboarding', backend: 'hub', messages: [hello] })
    })

    it('answers null before the onboarding started', async () => {
        seed({ foreman_conversations: [] }, onboardingWorkspace)
        const { GET } = await import('@/app/api/chat/foreman/route')
        expect(await expectContract(mobileApi.getLegacyForemanConversation, await callRoute(GET, mobileApi.getLegacyForemanConversation))).toBeNull()
    })

    it('streams the answer of the model the hub runs', async () => {
        seed({ agents: [], foreman_conversations: [] }, onboardingWorkspace)
        const { POST } = await import('@/app/api/chat/foreman/route')
        const res = await callRoute(POST, mobileApi.sendLegacyForemanMessage, { body: { sessionId: 'fm-onboarding', messages: [hello], client: 'ios' } })
        expect(answerOf(await expectContract(mobileApi.sendLegacyForemanMessage, res)).text).toBe('Nice to meet you. What takes most of your week?')
    })

    it('answers 423 engine_waitlist while the pool has no machine', async () => {
        state.poolHasRoom = false
        seed({ agents: [], engine_pool: [], foreman_conversations: [] }, onboardingWorkspace)
        const { POST } = await import('@/app/api/chat/foreman/route')
        const res = await callRoute(POST, mobileApi.sendLegacyForemanMessage, { body: { sessionId: 'fm-onboarding', messages: [hello], client: 'ios' } })
        expect(res.status).toBe(423)
        expect(await expectContract(mobileApi.sendLegacyForemanMessage, res, 423)).toEqual({ error: 'engine_waitlist' })
    })

    it('answers 409 onboarding_over once the team is built', async () => {
        seed({ foreman_conversations: [] })
        const { POST } = await import('@/app/api/chat/foreman/route')
        const res = await callRoute(POST, mobileApi.sendLegacyForemanMessage, { body: { sessionId: 'fm-onboarding', messages: [hello], client: 'ios' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendLegacyForemanMessage, res, 409)).toEqual({ error: 'onboarding_over' })
    })

    it('answers 409 engine_conversation for a conversation on the engine', async () => {
        seed()
        const { POST } = await import('@/app/api/chat/foreman/route')
        const res = await callRoute(POST, mobileApi.sendLegacyForemanMessage, { body: { sessionId: 'fm-general', messages: [hello], client: 'ios' } })
        expect(res.status).toBe(409)
        expect(await expectContract(mobileApi.sendLegacyForemanMessage, res, 409)).toEqual({ error: 'engine_conversation' })
    })
})
