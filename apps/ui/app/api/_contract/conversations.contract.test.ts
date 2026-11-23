import { appendAttachmentsRef, buildAttachmentsRef, contextTextPart, mobileApi, providerSwitchEntry } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import type { BrainPageDetail } from '@/lib/engine/client'
import type { EngineMessage, EngineRun, EngineSkillProposal } from '@/lib/engine/types'
import { callRoute, contractContext, contractSessionUser, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase, type SupabaseResolver } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Partial<Tables[T]['Row']>
type SessionWorkspace = Awaited<ReturnType<typeof import('@/supabase/session/getServerSession').getSessionWorkspace>>

// A conversation of the app: its transcript and the run behind it, the votes and the rules it
// offered, the inbox that points at it. The services run for real on a fake database and a fake
// engine; only what lies past them is replaced.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null }))

const engine = vi.hoisted(() => ({
    getSessionMessages: vi.fn<typeof import('@/lib/engine/client').getSessionMessages>(),
    listRuns: vi.fn<typeof import('@/lib/engine/client').listRuns>(),
    cancelRun: vi.fn<typeof import('@/lib/engine/client').cancelRun>(),
    listSkillProposals: vi.fn<typeof import('@/lib/engine/client').listSkillProposals>(),
    decideSkillProposal: vi.fn<typeof import('@/lib/engine/client').decideSkillProposal>(),
    revertBrainPage: vi.fn<typeof import('@/lib/engine/client').revertBrainPage>(),
    chat: vi.fn<typeof import('@/lib/engine/client').chat>(),
}))

vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), ...engine }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => state.ctx,
    requireAdminContext: async () => state.ctx,
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ ...state.db?.client, auth: { getUser: async () => ({ data: { user: state.ctx?.authUser } }) } }),
    getRequestAccessToken: async () => 'token',
}))
vi.mock('@/supabase/session/getServerSession', async importOriginal => ({
    ...(await importOriginal<typeof import('@/supabase/session/getServerSession')>()),
    getAuthUser: async () => state.ctx?.authUser,
    getSessionWorkspace: async (): Promise<SessionWorkspace> => ({
        supabase: state.db!.client,
        user: contractSessionUser('user-ada', 7),
        workspaceRefused: false,
        membership: { role: 'admin', box_scope: 'all' },
    }),
}))

const AGENT = '3f6c1d2e-4a5b-4c7d-8e9f-0a1b2c3d4e5f'
const BAKERIES = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f'
const PRICING = '7a2d3b5f-9c4e-4d6f-a081-2b3c4d5e6f70'
const DIGEST = '8b3e4c60-ad5f-4e70-b192-3c4d5e6f7081'
const FOR_GRACE = '9c4f5d71-be60-4f81-a2a3-4d5e6f708192'
const MORNING_RUN_1 = 'a05f6e82-cf71-4092-93b4-5e6f708192a3'
const MORNING_RUN_2 = 'b1607f93-d082-41a3-84c5-6f708192a3b4'
const ELSEWHERE = 'c271809a-e193-42b4-a5d6-708192a3b4c5'
const FEEDBACK = 'd38291ab-f2a4-43c5-86e7-8192a3b4c5d6'
const CHIEF = 'e49302bc-03b5-44d6-97f8-92a3b4c5d6e8'
const CHIEF_MINE = 'f5a413cd-14c6-45e7-a809-a3b4c5d6e7f9'
const CHIEF_GRACE = '06b524de-25d7-46f8-b91a-b4c5d6e7f80a'

const agentInBox = { workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'scout' }

const spaces: Row<'spaces'>[] = [{ id: 'space-sales', workspace_id: 7, name: 'Sales', visibility: 'workspace', created_at: '2026-11-02T09:00:00.000Z' }]

const agents: (Row<'agents'> & { space: Row<'spaces'> })[] = [
    { id: AGENT, name: 'Scout', handle: 'scout', kind: 'coworker', ...agentInBox, disabled_at: null, disabled_reason: null, space: { visibility: 'workspace' } },
    { id: CHIEF, name: 'Chief of Staff', handle: null, kind: 'foreman', workspace_id: 7, space_id: null, engine_agent_id: 'foreman', disabled_at: null, disabled_reason: null, space: null as never },
    { id: 'agent-other-workspace', name: 'Intruder', handle: 'intruder', kind: 'coworker', workspace_id: 9, space_id: 'space-other', engine_agent_id: 'intruder', disabled_at: null, disabled_reason: null, space: { visibility: 'workspace' } },
]

const sessions: (Row<'sessions'> & { agent: Row<'agents'> })[] = [
    { id: BAKERIES, agent_id: AGENT, engine_session_id: 'eng-bakeries', title: 'Bakeries in Lyon', status: 'working', kind: 'thread', source: 'dashboard', updated_at: '2026-11-19T08:40:00.000Z', agent: agentInBox },
    { id: PRICING, agent_id: AGENT, engine_session_id: 'eng-pricing', title: 'Quote for Maison Perrin', status: 'awaiting_question', kind: 'thread', source: 'dashboard', updated_at: '2026-11-19T08:30:00.000Z', agent: agentInBox },
    { id: DIGEST, agent_id: AGENT, engine_session_id: 'eng-digest', title: 'Weekly lead digest', status: 'awaiting_ack', kind: 'thread', source: 'schedule', updated_at: '2026-11-19T07:00:00.000Z', agent: agentInBox },
    { id: FOR_GRACE, agent_id: AGENT, engine_session_id: 'eng-grace', title: 'Send the Q4 deck', status: 'awaiting_approval', kind: 'thread', source: 'dashboard', updated_at: '2026-11-19T06:00:00.000Z', agent: agentInBox },
    { id: CHIEF_MINE, agent_id: CHIEF, owner_user_id: 'user-ada', engine_session_id: 'eng-chief-ada', title: 'Your invoices coworker keeps failing', status: 'awaiting_question', kind: 'thread', source: 'schedule', updated_at: '2026-11-19T08:50:00.000Z', agent: { workspace_id: 7, space_id: null, engine_agent_id: 'foreman' } },
    { id: CHIEF_GRACE, agent_id: CHIEF, owner_user_id: 'user-grace', engine_session_id: 'eng-chief-grace', title: 'Grace asked about the payroll', status: 'awaiting_question', kind: 'thread', source: 'dashboard', updated_at: '2026-11-19T08:55:00.000Z', agent: { workspace_id: 7, space_id: null, engine_agent_id: 'foreman' } },
    { id: ELSEWHERE, agent_id: 'agent-other-workspace', engine_session_id: 'eng-elsewhere', title: 'Bakeries of another company', status: 'idle', kind: 'thread', source: 'dashboard', updated_at: '2026-11-19T09:00:00.000Z', agent: { workspace_id: 9, space_id: 'space-other', engine_agent_id: 'intruder' } },
]

const notifications: Row<'notifications'>[] = [
    { id: 'n-pricing', agent_id: AGENT, engine_session_id: 'eng-pricing', kind: 'question', message: 'Which price list should I quote, the 2026 one or the summer promo?', metadata: { toolName: 'ask_user' }, recipients: { 'user-ada': 'mine' }, created_at: '2026-11-19T08:30:00.000Z' },
    { id: 'n-digest', agent_id: AGENT, engine_session_id: 'eng-digest', kind: 'info', message: '12 new leads this week, 3 of them in Villeurbanne.', metadata: { toolName: 'notify_user' }, recipients: { 'user-ada': 'followed' }, created_at: '2026-11-19T07:00:00.000Z' },
    { id: 'n-grace', agent_id: AGENT, engine_session_id: 'eng-grace', kind: 'approval', message: 'Send the Q4 deck to the board?', metadata: { toolName: 'request_approval' }, recipients: { 'user-grace': 'mine' }, created_at: '2026-11-19T06:00:00.000Z' },
    { id: 'n-chief-ada', agent_id: CHIEF, engine_session_id: 'eng-chief-ada', kind: 'question', message: 'Should I pause it until Monday?', metadata: { toolName: 'ask_user' }, recipients: { 'user-ada': 'mine' }, created_at: '2026-11-19T08:50:00.000Z' },
    { id: 'n-chief-grace', agent_id: CHIEF, engine_session_id: 'eng-chief-grace', kind: 'question', message: 'Which payroll month?', metadata: { toolName: 'ask_user' }, recipients: { 'user-grace': 'mine' }, created_at: '2026-11-19T08:55:00.000Z' },
    { id: 'n-skill', agent_id: AGENT, engine_session_id: 'eng-bakeries', kind: 'approval', message: 'Remember how to qualify a bakery?', metadata: { toolName: 'skill_propose' }, recipients: { 'user-ada': 'mine' }, created_at: '2026-11-19T08:41:00.000Z' },
]

const unseenRuns: Database['public']['Functions']['unseen_runs']['Returns'] = [
    { session_id: MORNING_RUN_2, agent_id: AGENT, source: 'schedule', slug: 'morning-prospects', title: 'Found 4 new bakeries', message: '4 bakeries added to the sheet.', run_count: 1, last_at: '2026-11-19T07:30:00.000Z', automation_name: null },
    { session_id: MORNING_RUN_1, agent_id: AGENT, source: 'schedule', slug: 'morning-prospects', title: 'Found 2 new bakeries', message: '2 bakeries added to the sheet.', run_count: 1, last_at: '2026-11-18T07:30:00.000Z', automation_name: null },
    { session_id: ELSEWHERE, agent_id: 'agent-other-workspace', source: 'dashboard', slug: null, title: 'Not for this inbox', message: 'Done.', run_count: 1, last_at: '2026-11-19T09:00:00.000Z', automation_name: null },
]

const messageFeedback: Row<'message_feedback'>[] = [
    { id: FEEDBACK, workspace_id: 7, session_id: BAKERIES, agent_id: AGENT, message_id: 'engine-msg-a2', rating: 'up', user_id: 'user-ada' },
    { id: 'e4930abc-03b5-44d6-97f8-92a3b4c5d6e7', workspace_id: 7, session_id: PRICING, agent_id: AGENT, message_id: 'engine-msg-x', rating: 'down', user_id: 'user-ada' },
]

const tables = {
    spaces,
    agents,
    sessions,
    notifications,
    message_feedback: messageFeedback,
    space_members: [],
    users: [],
    workspaces: [{ id: 7, locale: null }],
    engine_pool: [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }],
    'rpc:unseen_runs': unseenRuns,
}

const ATTACHMENT = 'chat-uploads/lq3x9k2a-AbC123-prospects.csv'

// What the engine keeps of one turn: the person's message with the context it appended, the answer
// streamed with its reasoning and its tool calls, the tool row holding their results, the model
// switch stored beside the answer, and the replies the model closed its next answer with.
const transcript: EngineMessage[] = [
    {
        id: 'msg-u1',
        sessionId: 'eng-bakeries',
        role: 'user',
        contentJson: JSON.stringify([{ type: 'text', text: appendAttachmentsRef('Find bakeries in Lyon that are not in this list yet.', buildAttachmentsRef([ATTACHMENT])) }, contextTextPart('<memories>Ada sells to independent bakeries.</memories>')]),
        toolCallsJson: null,
        authorId: 'user-ada',
        createdAt: '2026-11-19T08:38:00.000Z',
    },
    {
        id: 'msg-a1',
        sessionId: 'eng-bakeries',
        role: 'assistant',
        contentJson: JSON.stringify([
            { type: 'reasoning', text: 'Read the list first, then search for the missing ones.' },
            { type: 'text', text: 'Reading your list, then searching.' },
            { type: 'tool-call', toolCallId: 'call-read', toolName: 'fs_read', input: { path: ATTACHMENT } },
            { type: 'tool-call', toolCallId: 'call-search', toolName: 'web_search', input: { query: 'boulangerie artisanale Lyon 7e' } },
            { type: 'tool-call', toolCallId: 'call-fetch', toolName: 'linkup_fetch', input: { url: 'https://www.pagesjaunes.fr/annuaire/lyon-69/boulangeries' } },
        ]),
        toolCallsJson: JSON.stringify([
            providerSwitchEntry({
                kind: 'switch',
                from: { connectionId: 'conn-claude', provider: 'claude', model: 'claude-sonnet-4-5', name: 'Claude Max' },
                to: { connectionId: 'conn-openrouter', provider: 'openrouter', model: 'openai/gpt-5', name: 'OpenRouter' },
                resetsAt: '2026-11-19T14:00:00.000Z',
            }),
        ]),
        createdAt: '2026-11-19T08:38:05.000Z',
    },
    {
        id: 'msg-t1',
        sessionId: 'eng-bakeries',
        role: 'tool',
        contentJson: JSON.stringify([
            { type: 'tool-result', toolCallId: 'call-read', toolName: 'fs_read', output: { type: 'text', value: 'name,city\n'.padEnd(20_000, 'Boulangerie Perrin,Lyon\n') } },
            { type: 'tool-result', toolCallId: 'call-search', toolName: 'web_search', output: { type: 'json', value: { results: [{ title: 'Boulangerie Saint-Louis', url: 'https://boulangerie-saint-louis.fr' }] } } },
            { type: 'tool-result', toolCallId: 'call-fetch', toolName: 'linkup_fetch', output: { type: 'error-text', value: 'Timed out after 30s' } },
        ]),
        toolCallsJson: null,
        createdAt: '2026-11-19T08:38:20.000Z',
    },
    {
        id: 'msg-a2',
        sessionId: 'eng-bakeries',
        role: 'assistant',
        contentJson: JSON.stringify([{ type: 'text', text: 'Boulangerie Saint-Louis is not in your list yet.' }]),
        toolCallsJson: JSON.stringify([{ toolCallId: 'call-replies', toolName: 'suggest_replies', input: { replies: ['Find 20 more', 'Add it to the sheet'] } }]),
        createdAt: '2026-11-19T08:38:30.000Z',
    },
]

function run(overrides: Partial<EngineRun>): EngineRun {
    return {
        id: 'run-1',
        agentId: 'scout',
        sessionId: 'eng-bakeries',
        status: 'done',
        stepCount: 3,
        usageJson: null,
        provider: 'openrouter',
        model: 'openai/gpt-5',
        triggerSource: null,
        triggerSlug: null,
        costMicros: 12_400,
        inputTokens: 18_000,
        outputTokens: 900,
        cachedInputTokens: 12_000,
        reasoningTokens: 300,
        totalTokens: 18_900,
        startedAt: '2026-11-19T08:30:00.000Z',
        finishedAt: '2026-11-19T08:31:00.000Z',
        error: null,
        ...overrides,
    }
}

const proposal: EngineSkillProposal = {
    id: 'prop-qualify',
    sessionId: 'eng-bakeries',
    toolCallId: 'call-propose',
    mode: 'create',
    slug: null,
    title: 'Qualify a bakery',
    summary: 'Check opening hours and reviews before adding a bakery.',
    instructions: ['Add a bakery only when it opens before 7am and has more than 50 reviews.'],
    status: 'proposed',
    appliedSlug: null,
    error: null,
    createdAt: '2026-11-19T08:41:00.000Z',
}

const revertedPage: BrainPageDetail = {
    page: {
        slug: 'pricing',
        title: 'Pricing',
        type: 'offering',
        hash: 'h-before',
        updatedAt: '2026-11-19T09:10:00.000Z',
        updatedBy: 'user:ada@atelier-nord.fr',
        tags: ['pricing'],
        createdBy: 'seed',
        spaceId: null,
        content: '# Pricing\n\nCroissants at 1.20 EUR wholesale.',
        sources: [],
        unconfirmed: [],
        links: [],
        backlinks: [],
    },
    revisions: [{ id: 'rev-1', slug: 'pricing', title: 'Pricing', hash: 'h-before', author: 'seed', proposalId: null, createdAt: '2026-11-12T09:00:00.000Z' }],
}

describe('a conversation in the mobile app', () => {
    beforeEach(() => {
        const rows = tableResolver(tables)
        const resolve: SupabaseResolver = (table, calls) => {
            if (table === 'message_feedback' && writeMethodOf(calls) === 'upsert') return { data: { id: FEEDBACK } }
            // An update that hands back its rows: none to copy for the shipped builds here.
            if (table === 'sessions' && writeMethodOf(calls) === 'update' && calls.some(call => call.method === 'select')) return { data: [] }
            return rows(table, calls)
        }
        const db = fakeSupabase(resolve)
        state.db = db
        state.ctx = contractContext(db)
        for (const fn of Object.values(engine)) fn.mockReset()
        engine.getSessionMessages.mockResolvedValue(transcript)
        engine.listRuns.mockResolvedValue([run({ id: 'run-1', status: 'done' }), run({ id: 'run-2', status: 'running', startedAt: '2026-11-19T08:38:00.000Z', finishedAt: null })])
        engine.cancelRun.mockResolvedValue()
        engine.listSkillProposals.mockResolvedValue([proposal])
        engine.decideSkillProposal.mockResolvedValue({ ...proposal, status: 'accepted' })
        engine.revertBrainPage.mockResolvedValue(revertedPage)
    })

    describe('the transcript', () => {
        it('reads the engine transcript as the app renders it', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/messages/route')
            const messages = (await expectContract(mobileApi.getConversationMessages, await callRoute(GET, mobileApi.getConversationMessages, { params: { id: BAKERIES } }))) as { id: string; role: string; parts: Record<string, unknown>[]; metadata?: Record<string, unknown> }[]

            expect(engine.getSessionMessages).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'scout', 'eng-bakeries')
            expect(messages.map(message => [message.id, message.role])).toEqual([
                ['engine-msg-u1', 'user'],
                ['engine-msg-a1', 'assistant'],
                ['engine-msg-a2', 'assistant'],
            ])

            const [question, answer, followUp] = messages
            expect(question.parts).toEqual([{ type: 'text', text: 'Find bakeries in Lyon that are not in this list yet.' }])
            expect(question.metadata).toEqual({ createdAt: '2026-11-19T08:38:00.000Z', authorId: 'user-ada', attachments: [{ name: 'prospects.csv', path: ATTACHMENT, mediaType: 'text/csv' }] })

            expect(answer.parts.map(part => part.type)).toEqual(['data-provider-switch', 'text', 'tool-fs_read', 'tool-web_search', 'tool-linkup_fetch'])
            const [providerSwitch, , read, search, fetch] = answer.parts
            expect(providerSwitch.data).toMatchObject({ kind: 'switch', to: { provider: 'openrouter', name: 'OpenRouter' } })
            expect(read).toMatchObject({ toolCallId: 'call-read', state: 'output-available', output: { truncated: true } })
            expect(search).toMatchObject({ toolCallId: 'call-search', state: 'output-available', output: { type: 'json', value: { results: [{ title: 'Boulangerie Saint-Louis' }] } } })
            expect(fetch).toMatchObject({ toolCallId: 'call-fetch', state: 'output-error', errorText: 'Timed out after 30s' })
            expect(answer.metadata).toEqual({ createdAt: '2026-11-19T08:38:05.000Z' })

            expect(followUp.parts).toEqual([
                { type: 'text', text: 'Boulangerie Saint-Louis is not in your list yet.' },
                { type: 'tool-suggest_replies', toolCallId: 'call-replies', toolName: 'suggest_replies', state: 'input-available', input: { replies: ['Find 20 more', 'Add it to the sheet'] } },
            ])
        })

        it('answers 404 for a conversation of another workspace', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/messages/route')
            const res = await callRoute(GET, mobileApi.getConversationMessages, { params: { id: ELSEWHERE } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.getConversationMessages, res, 404)
            expect(engine.getSessionMessages).not.toHaveBeenCalled()
        })

        it('answers 502 when the Box does not answer', async () => {
            engine.getSessionMessages.mockRejectedValue(new TypeError('fetch failed'))
            const { GET } = await import('@/app/api/v1/conversations/[id]/messages/route')
            const res = await callRoute(GET, mobileApi.getConversationMessages, { params: { id: BAKERIES } })
            expect(res.status).toBe(502)
            expect(await expectContract(mobileApi.getConversationMessages, res, 502)).toMatchObject({ error: 'The Box did not answer. Try again in a moment.' })
        })

        it('answers 304 without a body when the app still holds the transcript', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/messages/route')
            const first = await callRoute(GET, mobileApi.getConversationMessages, { params: { id: BAKERIES } })
            await expectContract(mobileApi.getConversationMessages, first)
            const etag = first.headers.get('etag') ?? ''
            const again = await callRoute(GET, mobileApi.getConversationMessages, { params: { id: BAKERIES }, headers: { 'if-none-match': etag } })
            expect(again.status).toBe(304)
            expect(await expectContract(mobileApi.getConversationMessages, again)).toBeUndefined()
            expect(again.headers.get('etag')).toBe(etag)
        })
    })

    describe('the run', () => {
        it('names the run still going in the conversation', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/active-run/route')
            expect(await expectContract(mobileApi.getActiveRun, await callRoute(GET, mobileApi.getActiveRun, { params: { id: BAKERIES } }))).toEqual({ runId: 'run-2' })
        })

        it('answers null when nothing runs', async () => {
            engine.listRuns.mockResolvedValue([run({ id: 'run-1', status: 'done' })])
            const { GET } = await import('@/app/api/v1/conversations/[id]/active-run/route')
            expect(await expectContract(mobileApi.getActiveRun, await callRoute(GET, mobileApi.getActiveRun, { params: { id: BAKERIES } }))).toEqual({ runId: null })
        })

        it('stops every run of the conversation and leaves it idle', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/stop/route')
            await expectContract(mobileApi.stopConversation, await callRoute(POST, mobileApi.stopConversation, { params: { id: BAKERIES } }))
            expect(engine.cancelRun).toHaveBeenCalledTimes(1)
            expect(engine.cancelRun).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'scout', 'run-2')
            expect(state.db?.writes('sessions')).toEqual([{ method: 'update', payload: { status: 'idle' }, filters: [{ table: 'sessions', method: 'eq', args: ['id', BAKERIES] }] }])
        })

        it('approves from a push the card it names, and refuses it once it no longer waits', async () => {
            engine.getSessionMessages.mockResolvedValue([
                { id: 'msg-g1', sessionId: 'eng-grace', role: 'assistant', contentJson: JSON.stringify([{ type: 'text', text: 'Ready to send.' }, { type: 'tool-call', toolCallId: 'call-grace', toolName: 'request_approval', input: { approvals: [{ action: 'Send the Q4 deck to the board' }] } }]), toolCallsJson: null, authorId: null, createdAt: '2026-11-19T06:00:00.000Z' },
            ])
            engine.chat.mockResolvedValue(new Response('data: {}\n\n', { headers: { 'x-run-id': 'run-grace' } }))
            const { POST } = await import('@/app/api/v1/conversations/[id]/reply/route')
            expect(await expectContract(mobileApi.replyToConversation, await callRoute(POST, mobileApi.replyToConversation, { params: { id: FOR_GRACE }, body: { action: 'approve', toolCallId: 'call-grace' } }))).toEqual({ runId: 'run-grace' })
            expect(engine.chat.mock.calls[0][2]).toMatchObject({ sessionId: 'eng-grace', message: expect.stringContaining('1. **APPROVED** — Send the Q4 deck to the board') })
            expect(state.db?.writes('sessions')[0]).toMatchObject({ method: 'update', payload: { status: 'working' }, filters: expect.arrayContaining([expect.objectContaining({ method: 'eq', args: ['status', 'awaiting_approval'] })]) })
            expect(await expectContract(mobileApi.replyToConversation, await callRoute(POST, mobileApi.replyToConversation, { params: { id: FOR_GRACE }, body: { action: 'deny', toolCallId: 'call-older' } }), 409)).toMatchObject({ code: 'requestAlreadyAnswered' })
        })

        it('clears the heads-up the person read, and only that one', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/acknowledge/route')
            await expectContract(mobileApi.acknowledgeConversation, await callRoute(POST, mobileApi.acknowledgeConversation, { params: { id: DIGEST } }))
            expect(state.db?.writes('sessions')).toEqual([
                {
                    method: 'update',
                    payload: { status: 'idle' },
                    filters: [
                        { table: 'sessions', method: 'eq', args: ['id', DIGEST] },
                        { table: 'sessions', method: 'eq', args: ['status', 'awaiting_ack'] },
                    ],
                },
            ])
        })

        it('answers 404 when the conversation to stop is not the caller’s', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/stop/route')
            const res = await callRoute(POST, mobileApi.stopConversation, { params: { id: ELSEWHERE } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.stopConversation, res, 404)
            expect(engine.cancelRun).not.toHaveBeenCalled()
        })
    })

    describe('the rules the coworker offers to remember', () => {
        it('lists the proposals of the conversation', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/skill-proposals/route')
            expect(await expectContract(mobileApi.listSkillProposals, await callRoute(GET, mobileApi.listSkillProposals, { params: { id: BAKERIES } }))).toEqual({ proposals: [proposal] })
            expect(engine.listSkillProposals).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'scout', 'eng-bakeries')
        })

        it('accepts one and clears the wait it raised', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/skill-proposals/route')
            const decided = await expectContract(mobileApi.decideSkillProposal, await callRoute(POST, mobileApi.decideSkillProposal, { params: { id: BAKERIES }, body: { proposalId: 'prop-qualify', decision: 'accept' } }))
            expect(decided).toEqual({ proposal: { ...proposal, status: 'accepted' } })
            expect(engine.decideSkillProposal).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'scout', 'prop-qualify', 'accept')
            expect(state.db?.writes('sessions')).toEqual([
                {
                    method: 'update',
                    payload: { status: 'idle' },
                    filters: [
                        { table: 'sessions', method: 'eq', args: ['id', BAKERIES] },
                        { table: 'sessions', method: 'eq', args: ['status', 'awaiting_approval'] },
                    ],
                },
            ])
        })
    })

    describe('the votes on the answers', () => {
        it('reads the votes of the conversation', async () => {
            const { GET } = await import('@/app/api/v1/conversations/[id]/feedback/route')
            expect(await expectContract(mobileApi.listMessageFeedback, await callRoute(GET, mobileApi.listMessageFeedback, { params: { id: BAKERIES } }))).toEqual({ feedback: [{ id: FEEDBACK, messageId: 'engine-msg-a2', rating: 'up' }] })
        })

        it('records a vote with a copy of the transcript', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/feedback/route')
            const body = { messageId: 'engine-msg-a2', rating: 'down', messageText: 'Boulangerie Saint-Louis is not in your list yet.' } as const
            expect(await expectContract(mobileApi.rateMessage, await callRoute(POST, mobileApi.rateMessage, { params: { id: BAKERIES }, body }))).toEqual({ id: FEEDBACK })
            const [write] = state.db?.writes('message_feedback') ?? []
            expect(write.method).toBe('upsert')
            expect(write.payload).toMatchObject({ workspace_id: 7, user_id: 'user-ada', agent_id: AGENT, session_id: BAKERIES, message_id: 'engine-msg-a2', rating: 'down' })
            expect((write.payload as { transcript: unknown[] }).transcript).toHaveLength(3)
        })

        it('answers 404 for a vote on a conversation of another workspace', async () => {
            const { POST } = await import('@/app/api/v1/conversations/[id]/feedback/route')
            const res = await callRoute(POST, mobileApi.rateMessage, { params: { id: ELSEWHERE }, body: { messageId: 'engine-msg-a2', rating: 'up', messageText: 'Done.' } })
            expect(res.status).toBe(404)
            await expectContract(mobileApi.rateMessage, res, 404)
            expect(state.db?.writes('message_feedback')).toEqual([])
        })

        it('adds what went wrong to a vote', async () => {
            const { PATCH } = await import('@/app/api/v1/feedback/[id]/route')
            await expectContract(mobileApi.updateMessageFeedback, await callRoute(PATCH, mobileApi.updateMessageFeedback, { params: { id: FEEDBACK }, body: { category: 'incomplete', details: 'Missed the bakeries of the 7th' } }))
            const [write] = state.db?.writes('message_feedback') ?? []
            expect(write.payload).toMatchObject({ category: 'incomplete', details: 'Missed the bakeries of the 7th' })
            expect(write.filters.map(filter => filter.args)).toEqual([
                ['id', FEEDBACK],
                ['workspace_id', 7],
            ])
        })

        it('takes a vote back', async () => {
            const { DELETE } = await import('@/app/api/v1/feedback/[id]/route')
            await expectContract(mobileApi.clearMessageFeedback, await callRoute(DELETE, mobileApi.clearMessageFeedback, { params: { id: FEEDBACK } }))
            expect(state.db?.writes('message_feedback')).toMatchObject([{ method: 'delete', filters: [{ args: ['id', FEEDBACK] }, { args: ['workspace_id', 7] }] }])
        })
    })

    describe('the search', () => {
        it('finds the caller’s conversations by their title', async () => {
            const { GET } = await import('@/app/api/v1/conversations/search/route')
            expect(await expectContract(mobileApi.searchConversations, await callRoute(GET, mobileApi.searchConversations, { query: { q: 'bakeries' } }))).toEqual([{ id: BAKERIES, agentId: AGENT, title: 'Bakeries in Lyon', status: 'working', updatedAt: '2026-11-19T08:40:00.000Z' }])
        })

        it('lists the latest conversations of one coworker without text', async () => {
            const { GET } = await import('@/app/api/v1/conversations/search/route')
            const hits = (await expectContract(mobileApi.searchConversations, await callRoute(GET, mobileApi.searchConversations, { query: { agentId: AGENT } }))) as { id: string }[]
            expect(hits.map(hit => hit.id)).toEqual([BAKERIES, PRICING, DIGEST, FOR_GRACE])
        })
    })

    describe('the Undo of a Brain change', () => {
        it('puts the page back to the revision it had before', async () => {
            const { POST } = await import('@/app/api/v1/brain/pages/[slug]/revert/route')
            await expectContract(mobileApi.revertBrainPage, await callRoute(POST, mobileApi.revertBrainPage, { params: { slug: 'pricing' }, body: { revisionId: 'rev-1', expectedHash: 'h-after' } }))
            expect(engine.revertBrainPage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'pricing', 'rev-1', 'user:ada@atelier-nord.fr', 'h-after')
        })

        it('answers 409 when the page changed since', async () => {
            const { EngineRequestError } = await import('@/lib/engine/client')
            engine.revertBrainPage.mockRejectedValue(new EngineRequestError('Page changed since', 409))
            const { POST } = await import('@/app/api/v1/brain/pages/[slug]/revert/route')
            const res = await callRoute(POST, mobileApi.revertBrainPage, { params: { slug: 'pricing' }, body: { revisionId: 'rev-1', expectedHash: 'h-after' } })
            expect(res.status).toBe(409)
            expect(await expectContract(mobileApi.revertBrainPage, res, 409)).toMatchObject({ error: 'This page changed since. Open it and restore a version from its history.' })
        })
    })

    describe('the inbox', () => {
        it('lists what waits on the caller and the runs they have not seen', async () => {
            const { GET } = await import('@/app/api/v1/inbox/route')
            const inbox = await expectContract(mobileApi.getInbox, await callRoute(GET, mobileApi.getInbox))
            expect(inbox).toEqual({
                items: [
                    // The Chief of Staff's conversation with the caller, by its address; Grace's stays hers.
                    { id: CHIEF_MINE, sessionId: CHIEF_MINE, sessionIds: [CHIEF_MINE], agentId: 'foreman', agentName: 'Chief of Staff', status: 'awaiting_question', title: 'Your invoices coworker keeps failing', message: 'Should I pause it until Monday?', updatedAt: '2026-11-19T08:50:00.000Z', count: 1 },
                    { id: PRICING, sessionId: PRICING, sessionIds: [PRICING], agentId: AGENT, agentName: 'Scout', status: 'awaiting_question', title: 'Quote for Maison Perrin', message: 'Which price list should I quote, the 2026 one or the summer promo?', updatedAt: '2026-11-19T08:30:00.000Z', count: 1 },
                    { id: DIGEST, sessionId: DIGEST, sessionIds: [DIGEST], agentId: AGENT, agentName: 'Scout', status: 'awaiting_ack', title: 'Weekly lead digest', message: '12 new leads this week, 3 of them in Villeurbanne.', updatedAt: '2026-11-19T07:00:00.000Z', count: 1 },
                    { id: `done:${AGENT}:schedule:morning-prospects`, sessionId: MORNING_RUN_2, sessionIds: [MORNING_RUN_2, MORNING_RUN_1], agentId: AGENT, agentName: 'Scout', status: 'done', title: 'morning-prospects', message: null, updatedAt: '2026-11-19T07:30:00.000Z', count: 2 },
                ],
                running: 1,
            })
        })

        it('marks the rows read', async () => {
            const { POST } = await import('@/app/api/v1/inbox/read/route')
            await expectContract(mobileApi.markInboxRead, await callRoute(POST, mobileApi.markInboxRead, { body: { sessionIds: [PRICING, MORNING_RUN_2] } }))
            expect(state.db?.writes('sessions')).toMatchObject([
                { method: 'update', payload: { status: 'idle' }, filters: [{ args: ['agent_id', [AGENT]] }, { method: 'in', args: ['status', expect.arrayContaining(['awaiting_question'])] }, { args: ['id', [PRICING, MORNING_RUN_2]] }, { method: 'select' }] },
                // The caller's own conversations with the Chief of Staff, never another member's.
                { method: 'update', payload: { status: 'idle' }, filters: [{ args: ['agent_id', [CHIEF]] }, { method: 'in' }, { args: ['owner_user_id', 'user-ada'] }, { args: ['id', [PRICING, MORNING_RUN_2]] }, { method: 'select' }] },
            ])
            expect(state.db?.writes('session_reads')).toEqual([
                {
                    method: 'upsert',
                    payload: [
                        { session_id: PRICING, user_id: 'user-ada' },
                        { session_id: MORNING_RUN_2, user_id: 'user-ada' },
                    ],
                    filters: [],
                },
            ])
        })

        it('marks the whole inbox read', async () => {
            const { POST } = await import('@/app/api/v1/inbox/read/route')
            await expectContract(mobileApi.markInboxRead, await callRoute(POST, mobileApi.markInboxRead, { body: { all: true } }))
            const [read] = state.db?.writes('session_reads') ?? []
            expect(read.payload).toEqual(unseenRuns.map(unseen => ({ session_id: unseen.session_id, user_id: 'user-ada' })))
        })
    })
})
