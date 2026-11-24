import { mobileApi, type ForemanIntakeRequest } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import type { CompanyProfile } from '@/lib/company/analyze'
import { forgetMachine } from '@/lib/engine/engine-memory'
import { engineAgentDetailSchema, type EngineHealth } from '@/lib/engine/types'
import { AppError } from '@/lib/i18n/action-error'
import { PHONE_REQUIRED_MESSAGE } from '@/lib/phone/verification'
import { CONTRACT_WORKSPACE, callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, type FakeSupabase, type SupabaseResolver } from '@/test/supabase-fake'

type Tables = Database['public']['Tables']
type Rows<T extends keyof Tables> = Partial<Tables[T]['Row']>[]

// The onboarding the app walks before its Home: the welcome page's questions, the trial, the machine,
// and the `foreman/*` calls of the builds up to iOS 36 and Android 5, which ran it on the hub. The
// actions and services run for real on a fake database; only what lies past it is replaced: the
// pool, Trigger.dev, the engine, Firecrawl, the models and Stripe.
const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, ctx: null as WorkspaceContext | null, failingWrite: null as string | null }))

const provider = vi.hoisted(() => ({
    claimPoolEngine: vi.fn<typeof import('@rerun/cloud/engines').claimPoolEngine>(),
    poolHasRoom: vi.fn<typeof import('@rerun/cloud/engines').poolHasRoom>(),
    triggerTask: vi.fn<typeof import('@rerun/cloud/tasks').triggerTask>(),
    getEngineHealth: vi.fn<typeof import('@/lib/engine/client').getEngineHealth>(),
    supportsForemanFiles: vi.fn<typeof import('@/lib/engine/client').supportsForemanFiles>(),
    getAgent: vi.fn<typeof import('@/lib/engine/client').getAgent>(),
    chat: vi.fn<typeof import('@/lib/engine/client').chat>(),
    scrapeCompanySite: vi.fn<typeof import('@/lib/company/firecrawl').scrapeCompanySite>(),
    analyzeCompany: vi.fn<typeof import('@/lib/company/analyze').analyzeCompany>(),
    startCardlessTrial: vi.fn<typeof import('@/ee/services/billing.service').startCardlessTrial>(),
    updateUserById: vi.fn(async (_id: string, _attributes: { user_metadata: Record<string, string> }) => ({ data: { user: null }, error: null })),
    fetch: vi.fn<typeof fetch>(),
}))

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
    getServerSession: async () => ({ session: state.ctx?.authUser ?? null }),
    getAuthUser: async () => state.ctx?.authUser,
}))
vi.mock('next/headers', async importOriginal => ({
    ...(await importOriginal<typeof import('next/headers')>()),
    cookies: async () => ({ has: () => false, get: () => undefined, getAll: () => [] }),
    headers: async () => new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }),
}))
vi.mock('@rerun/cloud/edition', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/edition')>()), RERUN_CLOUD: true }))
vi.mock('@rerun/cloud/billing', async importOriginal => ({
    ...(await importOriginal<typeof import('@rerun/cloud/billing')>()),
    ...(await vi.importActual<typeof import('@/ee/lib/billing/entitlement')>('@/ee/lib/billing/entitlement')),
    ...(await vi.importActual<typeof import('@/ee/lib/billing/plans')>('@/ee/lib/billing/plans')),
    BILLING_ENABLED: true,
}))
vi.mock('@rerun/cloud/engines', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/engines')>()), claimPoolEngine: provider.claimPoolEngine, poolHasRoom: provider.poolHasRoom }))
vi.mock('@rerun/cloud/tasks', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/tasks')>()), triggerTask: provider.triggerTask, globalIdempotencyKey: async (key: string) => key }))
vi.mock('@/lib/engine/client', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/engine/client')>()),
    getEngineHealth: provider.getEngineHealth,
    supportsForemanFiles: provider.supportsForemanFiles,
    getAgent: provider.getAgent,
    chat: provider.chat,
}))
vi.mock('@/lib/company/firecrawl', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/company/firecrawl')>()), scrapeCompanySite: provider.scrapeCompanySite }))
vi.mock('@/lib/company/analyze', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/company/analyze')>()), analyzeCompany: provider.analyzeCompany }))
// The real one creates the Stripe customer and subscription, then applies it to the workspace through
// the whole billing webhook path: it has its own tests. Its refusals are thrown below as it throws them.
vi.mock('@/ee/services/billing.service', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/services/billing.service')>()), startCardlessTrial: provider.startCardlessTrial }))

const { ENGINE_WAITLIST_MESSAGE } = await import('@/ee/services/billing.service')

const FRESH_WORKSPACE: WorkspaceContext['workspace'] = { ...CONTRACT_WORKSPACE, onboarded_at: null, subscription_status: null }

const atelierNord: CompanyProfile = { name: 'Atelier Nord', industry: 'agencies', description: 'A design studio in Lille.', offering: 'Brand identities and websites', audience: 'Independent shops' }

const health: EngineHealth = { status: 'ok', activeAgents: 0, capabilities: [] }

const claimedEngine: Rows<'engine_pool'> = [{ id: 'pool-1', engine_host: 'box-001.rerun.internal', engine_api_key: 'key', provider_server_id: 'srv-1', claimed_by_workspace_id: 7 }]

let tables: {
    workspaces: Rows<'workspaces'>
    workspace_members: Rows<'workspace_members'>
    workspace_onboarding: Rows<'workspace_onboarding'>
    engine_pool: Rows<'engine_pool'>
    agents: Rows<'agents'>
    spaces: Rows<'spaces'>
    space_members: Rows<'space_members'>
    sessions: Rows<'sessions'>
    foreman_conversations: Rows<'foreman_conversations'>
}

// The rows of `tables`, where an upsert of a session lands as PostgREST would keep it, and a write
// named by `state.failingWrite` fails.
function database(): SupabaseResolver {
    const read = tableResolver(tables)
    return (table, calls) => {
        const write = calls.find(call => ['insert', 'update', 'upsert', 'delete'].includes(call.method))
        if (write && table === state.failingWrite) return { error: { message: 'connection terminated' } }
        if (table === 'sessions' && write?.method === 'upsert') tables.sessions.push({ id: 'session-install', created_at: new Date().toISOString(), ...(write.args[0] as Tables['sessions']['Insert']) })
        return read(table, calls)
    }
}

const onboardingWrites = () =>
    state.db
        ?.writes('workspace_onboarding')
        .filter(write => write.method === 'upsert')
        .map(write => (write.payload as Tables['workspace_onboarding']['Insert']).answers) ?? []

const intake = (fields: Partial<ForemanIntakeRequest>): ForemanIntakeRequest => ({ companyUrl: null, industry: null, decidedIndustry: null, industryLabel: null, position: null, firstName: null, ...fields })

function industryDecision(choice: string, confidence: number): Response {
    return Response.json({ answers: { industry: { choice, confidence } } })
}

describe('the onboarding of the mobile app', () => {
    beforeEach(() => {
        tables = {
            workspaces: [{ id: 7, name: 'My workspace', icon_url: null, is_sandbox: false, subscription_status: null, trial_ends_at: null, boxes_archived_at: null, waitlisted_at: null, onboarded_at: null }],
            workspace_members: [{ user_id: 'user-ada', workspace_id: 7, role: 'admin', box_scope: 'all', created_at: '2026-11-18T09:00:00.000Z' }],
            workspace_onboarding: [{ workspace_id: 7, answers: {}, company_findings: null }],
            engine_pool: [],
            agents: [],
            spaces: [{ id: 'space-sales', workspace_id: 7, name: 'Sales', visibility: 'workspace' }],
            space_members: [],
            sessions: [],
            foreman_conversations: [],
        }
        state.failingWrite = null
        const db = fakeSupabase(database())
        Object.assign(db.client, { auth: { admin: { updateUserById: provider.updateUserById } } })
        state.db = db
        state.ctx = contractContext(db, { workspace: FRESH_WORKSPACE })
        forgetMachine(7)

        for (const mock of Object.values(provider)) mock.mockReset()
        provider.updateUserById.mockResolvedValue({ data: { user: null }, error: null })
        provider.poolHasRoom.mockResolvedValue(true)
        // One fixture for Rerun Cloud's Trigger.dev handle and for the self-hosted `{ id }`.
        provider.triggerTask.mockResolvedValue({ id: 'run_trigger_1', publicAccessToken: 'pat_1', taskIdentifier: 'explore-company' } as unknown as Awaited<ReturnType<typeof provider.triggerTask>>)
        provider.scrapeCompanySite.mockResolvedValue('# Atelier Nord\nBrand identities for independent shops in Lille.')
        provider.analyzeCompany.mockResolvedValue(atelierNord)
        provider.fetch.mockImplementation(async input => (String(input).startsWith('https://openrouter.ai/api/alpha/decisions') ? industryDecision('real-estate', 0.92) : new Response(null, { status: 404 })))
        vi.stubGlobal('fetch', provider.fetch)
        vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    })

    describe('the welcome questions', () => {
        it('keeps a new workspace on the questions while its line of work is unanswered', async () => {
            tables.workspace_onboarding = [{ workspace_id: 7, answers: { company_url: 'https://atelier-nord.fr' } }]
            const { GET } = await import('@/app/api/v1/onboarding/route')
            expect(await expectContract(mobileApi.getOnboarding, await callRoute(GET, mobileApi.getOnboarding))).toEqual({ needed: true, stage: 'questions', waitlisted: false, firstName: 'Ada' })
        })

        it('moves to the setup once answered, and says when no machine is left to start on', async () => {
            tables.workspace_onboarding = [{ workspace_id: 7, answers: { company_url: 'https://atelier-nord.fr', industry: 'agencies', position: 'Founder', onboarding: { teamDone: true } } }]
            provider.poolHasRoom.mockResolvedValue(false)
            const { GET } = await import('@/app/api/v1/onboarding/route')
            expect(await expectContract(mobileApi.getOnboarding, await callRoute(GET, mobileApi.getOnboarding))).toEqual({ needed: true, stage: 'setup', waitlisted: true, firstName: 'Ada' })
            expect(state.db?.writes('workspaces').map(write => Object.keys(write.payload as object))).toEqual([['waitlisted_at']])
        })

        it('saves the answers of the card, read off the site', async () => {
            const { POST } = await import('@/app/api/v1/onboarding/intake/route')
            const body = intake({ companyUrl: 'atelier-nord.fr', decidedIndustry: 'agencies', position: 'Founder', firstName: 'Ada' })
            await expectContract(mobileApi.saveOnboardingIntake, await callRoute(POST, mobileApi.saveOnboardingIntake, { body }))
            expect(onboardingWrites()).toEqual([expect.objectContaining({ company_url: 'https://atelier-nord.fr', company_name: 'Atelier Nord', industry: 'agencies', position: 'Founder' })])
            expect(provider.updateUserById).toHaveBeenCalledWith('user-ada', { user_metadata: { first_name: 'Ada', full_name: 'Ada Lovelace' } })
            expect(provider.triggerTask).toHaveBeenCalledWith('explore-company', { workspaceId: 7, url: 'https://atelier-nord.fr' }, expect.anything())
        })

        it('guesses the industry of a site while the questions are answered', async () => {
            const { POST } = await import('@/app/api/v1/onboarding/industry/route')
            expect(await expectContract(mobileApi.decideOnboardingIndustry, await callRoute(POST, mobileApi.decideOnboardingIndustry, { body: { input: 'immo-lyon.fr' } }))).toEqual({ industry: 'real-estate' })
        })
    })

    describe('the trial', () => {
        it('starts it as the platform that asks, and marks it', async () => {
            provider.startCardlessTrial.mockResolvedValue(true)
            const { POST } = await import('@/app/api/v1/onboarding/trial/route')
            expect(await expectContract(mobileApi.startOnboardingTrial, await callRoute(POST, mobileApi.startOnboardingTrial, { client: 'android/1.1.0 (7)' }))).toEqual({ entitled: true })
            expect(provider.startCardlessTrial).toHaveBeenCalledWith('android')
            expect(onboardingWrites()).toEqual([{ foreman: { trialStartedIn: 'android' } }])
        })

        it('answers 409 with the phone step, which the app opens', async () => {
            provider.startCardlessTrial.mockRejectedValue(new AppError('phoneRequired'))
            const { POST } = await import('@/app/api/v1/onboarding/trial/route')
            const res = await callRoute(POST, mobileApi.startOnboardingTrial)
            expect(res.status).toBe(409)
            expect(await expectContract(mobileApi.startOnboardingTrial, res, 409)).toMatchObject({ error: PHONE_REQUIRED_MESSAGE })
        })

        it('answers 409 with the waitlist, which the app tells apart from the phone step', async () => {
            provider.startCardlessTrial.mockRejectedValue(new AppError('engineWaitlist'))
            const { POST } = await import('@/app/api/v1/onboarding/trial/route')
            const res = await callRoute(POST, mobileApi.startOnboardingTrial)
            expect(res.status).toBe(409)
            expect(await expectContract(mobileApi.startOnboardingTrial, res, 409)).toMatchObject({ error: ENGINE_WAITLIST_MESSAGE })
            expect(ENGINE_WAITLIST_MESSAGE).not.toBe(PHONE_REQUIRED_MESSAGE)
        })
    })

    describe('the machine', () => {
        it('claims it and seeds the Company Brain', async () => {
            tables.workspaces[0].subscription_status = 'trialing'
            provider.claimPoolEngine.mockResolvedValue({ ok: true, instance: { id: 'pool-1', engineHost: 'box-001.rerun.internal', engineApiKey: 'key' } })
            const { POST } = await import('@/app/api/v1/onboarding/engine/route')
            const res = await callRoute(POST, mobileApi.claimOnboardingEngine)
            expect(res.status).toBe(204)
            await expectContract(mobileApi.claimOnboardingEngine, res)
            expect(provider.claimPoolEngine).toHaveBeenCalledWith(7)
            expect(provider.triggerTask).toHaveBeenCalledWith('seed-company-brain', { workspaceId: 7, exploreKey: undefined }, { idempotencyKey: 'brain-seed-7' })
        })

        it('says why when no machine can be claimed', async () => {
            tables.workspaces[0].subscription_status = 'trialing'
            provider.claimPoolEngine.mockResolvedValue({ ok: false, raced: false, error: 'No machine is available right now' })
            const { POST } = await import('@/app/api/v1/onboarding/engine/route')
            const res = await callRoute(POST, mobileApi.claimOnboardingEngine)
            expect(res.status).toBe(503)
            expect(await expectContract(mobileApi.claimOnboardingEngine, res, 503)).toEqual({ error: 'No machine is available right now' })
        })

        it('tells whether the machine answers yet', async () => {
            const { GET } = await import('@/app/api/v1/onboarding/engine/route')
            expect(await expectContract(mobileApi.getOnboardingEngine, await callRoute(GET, mobileApi.getOnboardingEngine))).toEqual({ ready: false })
            expect(provider.getEngineHealth).not.toHaveBeenCalled()

            tables.engine_pool = claimedEngine
            provider.getEngineHealth.mockResolvedValue(health)
            expect(await expectContract(mobileApi.getOnboardingEngine, await callRoute(GET, mobileApi.getOnboardingEngine))).toEqual({ ready: true })
        })

        it('closes the onboarding: the Chief of Staff speaks first', async () => {
            const { POST } = await import('@/app/api/v1/onboarding/finish/route')
            const res = await callRoute(POST, mobileApi.finishOnboarding)
            expect(res.status).toBe(204)
            await expectContract(mobileApi.finishOnboarding, res)
            expect(onboardingWrites()).toEqual([{ onboarding: { greetPending: true } }])
            expect(state.db?.writes('workspaces').map(write => Object.keys(write.payload as object))).toEqual([['onboarded_at']])
        })

        it('answers the failure when the onboarding could not be closed', async () => {
            state.failingWrite = 'workspace_onboarding'
            const { POST } = await import('@/app/api/v1/onboarding/finish/route')
            const res = await callRoute(POST, mobileApi.finishOnboarding)
            expect(res.status).toBe(503)
            expect(await expectContract(mobileApi.finishOnboarding, res, 503)).toEqual({ error: 'connection terminated' })
        })
    })

    // Builds up to iOS 36 and Android 5 ran the onboarding through these, before the welcome page.
    describe('the foreman onboarding of the older builds', () => {
        const oldBuild = 'ios/1.0.0 (36)'

        it('saves the welcome card and closes discovery', async () => {
            const { POST } = await import('@/app/api/v1/foreman/intake/route')
            const body = intake({ companyUrl: 'https://www.atelier-nord.com', industry: 'agencies', position: 'Founder', firstName: 'Ada' })
            await expectContract(mobileApi.saveForemanIntake, await callRoute(POST, mobileApi.saveForemanIntake, { body, client: oldBuild }))
            expect(onboardingWrites()).toEqual([expect.objectContaining({ industry: 'agencies', company_name: 'Atelier Nord', foreman: expect.objectContaining({ profileAt: expect.any(String) }) })])
            expect(state.db?.writes('workspaces').map(write => Object.keys(write.payload as object))).toContainEqual(['onboarded_at'])
        })

        it('answers no industry for a social profile, without asking the model', async () => {
            const { POST } = await import('@/app/api/v1/foreman/industry/route')
            const res = await callRoute(POST, mobileApi.decideForemanIndustry, { body: { input: 'instagram.com/atelier.nord' }, client: oldBuild })
            expect(await expectContract(mobileApi.decideForemanIndustry, res)).toEqual({ industry: null })
            expect(provider.fetch).not.toHaveBeenCalled()
        })

        it('answers a spent trial as not entitled, which only the web takes further', async () => {
            provider.startCardlessTrial.mockResolvedValue(false)
            const { POST } = await import('@/app/api/v1/foreman/trial/route')
            expect(await expectContract(mobileApi.startForemanTrial, await callRoute(POST, mobileApi.startForemanTrial, { client: oldBuild }))).toEqual({ entitled: false })
            expect(onboardingWrites()).toEqual([])
        })

        it.each([
            ['phoneRequired', PHONE_REQUIRED_MESSAGE],
            ['engineWaitlist', 'Every machine is taken right now. Your trial can start as soon as one frees up.'],
        ] as const)('answers 409 on %s to the trial of an older build', async (code, message) => {
            provider.startCardlessTrial.mockRejectedValue(new AppError(code))
            const { POST } = await import('@/app/api/v1/foreman/trial/route')
            const res = await callRoute(POST, mobileApi.startForemanTrial, { client: oldBuild })
            expect(res.status).toBe(409)
            expect(await expectContract(mobileApi.startForemanTrial, res, 409)).toMatchObject({ error: message })
        })

        describe('the lead coworker', () => {
            const scout: Rows<'agents'>[number] = { id: 'agent-scout', name: 'Scout', kind: 'coworker', workspace_id: 7, space_id: 'space-sales', engine_agent_id: 'scout', disabled_at: null, disabled_reason: null }

            it('starts its install on the engine and answers its conversation', async () => {
                tables.agents = [scout]
                tables.engine_pool = claimedEngine
                provider.getAgent.mockResolvedValue(engineAgentDetailSchema.parse({ id: 'scout', config: { name: 'scout', displayName: 'Scout' }, soul: 'You find leads.' }))
                provider.chat.mockResolvedValue(new Response('data: {"type":"start"}\n\n', { headers: { 'content-type': 'text/event-stream', 'x-session-id': 'engine-session-9', 'x-run-id': 'run-9' } }))
                const { POST } = await import('@/app/api/v1/foreman/lead/route')
                const res = await callRoute(POST, mobileApi.startForemanLead, { body: { agentId: 'agent-scout' }, client: oldBuild })
                expect(await expectContract(mobileApi.startForemanLead, res)).toEqual({ conversationId: 'session-install', runId: 'run-9' })
                expect(provider.chat).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }), 'scout', expect.objectContaining({ source: 'api', install: false }))
            })

            it('opens the conversation of a lead already started, without a second install', async () => {
                tables.agents = [scout]
                tables.sessions = [{ id: 'session-1', agent_id: 'agent-scout', engine_session_id: 'engine-session-1', created_at: '2026-11-18T10:00:00.000Z' }]
                const { POST } = await import('@/app/api/v1/foreman/lead/route')
                const res = await callRoute(POST, mobileApi.startForemanLead, { body: { agentId: 'agent-scout' }, client: oldBuild })
                expect(await expectContract(mobileApi.startForemanLead, res)).toEqual({ conversationId: 'session-1', runId: null })
                expect(provider.chat).not.toHaveBeenCalled()
            })

            it('answers 409 for a lead the plan has no slot for', async () => {
                tables.agents = [{ ...scout, disabled_at: '2026-11-18T10:00:00.000Z', disabled_reason: 'plan_limit' }]
                const { POST } = await import('@/app/api/v1/foreman/lead/route')
                const res = await callRoute(POST, mobileApi.startForemanLead, { body: { agentId: 'agent-scout' }, client: oldBuild })
                expect(res.status).toBe(409)
                expect(await expectContract(mobileApi.startForemanLead, res, 409)).toMatchObject({ error: 'This coworker has no free slot on your plan.' })
            })
        })

        it('says whether the foreman of the engine takes files', async () => {
            const { GET } = await import('@/app/api/v1/foreman/files/route')
            expect(await expectContract(mobileApi.getForemanEngineFiles, await callRoute(GET, mobileApi.getForemanEngineFiles, { client: oldBuild }))).toEqual({ supported: false })

            tables.engine_pool = claimedEngine
            provider.supportsForemanFiles.mockResolvedValue(true)
            expect(await expectContract(mobileApi.getForemanEngineFiles, await callRoute(GET, mobileApi.getForemanEngineFiles, { client: oldBuild }))).toEqual({ supported: true })
        })

        it("lists the caller's engine conversations of the foreman, the latest first", async () => {
            tables.agents = [{ id: 'agent-cos', name: 'Chief of Staff', kind: 'foreman', workspace_id: 7, space_id: null, engine_agent_id: 'foreman' }]
            tables.sessions = [
                { id: 'fc-general', agent_id: 'agent-cos', owner_user_id: 'user-ada', kind: 'general', title: 'General', status: 'idle', first_message: null, engine_session_id: 'engine-general', created_at: '2026-11-18T09:00:00.000Z', updated_at: '2026-11-18T09:30:00.000Z' },
                { id: 'fc-thread', agent_id: 'agent-cos', owner_user_id: 'user-ada', kind: 'thread', title: 'Find me twenty agencies in Lille', status: 'awaiting_approval', first_message: 'Find me twenty agencies in Lille', engine_session_id: 'engine-thread', created_at: '2026-11-18T10:00:00.000Z', updated_at: '2026-11-18T10:05:00.000Z' },
                { id: 'fc-grace', agent_id: 'agent-cos', owner_user_id: 'user-grace', kind: 'general', title: 'General', status: 'idle', first_message: null, engine_session_id: 'engine-grace', created_at: '2026-11-18T09:00:00.000Z', updated_at: '2026-11-18T12:00:00.000Z' },
            ]
            tables.foreman_conversations = [{ id: 'fc-hub', workspace_id: 7, user_id: 'user-ada', backend: 'hub', kind: 'thread', title: 'Onboarding', status: 'idle', first_message: null, engine_session_id: null, created_at: '2026-11-17T09:00:00.000Z', updated_at: '2026-11-18T11:00:00.000Z' }]
            tables['rpc:unseen_runs'] = [{ session_id: 'fc-general', agent_id: 'agent-cos', source: 'dashboard', slug: null, title: 'General', message: 'Done.', run_count: 1, last_at: '2026-11-18T10:30:00.000Z', automation_name: null }]
            const { GET } = await import('@/app/api/v1/foreman/conversations/route')
            const conversations = (await expectContract(mobileApi.listForemanConversations, await callRoute(GET, mobileApi.listForemanConversations, { client: oldBuild }))) as { id: string; title: string; status: string; kind?: string; unseen?: boolean }[]
            expect(conversations.map(({ id, title, status, kind, unseen }) => ({ id, title, status, kind, unseen }))).toEqual([
                { id: 'fc-thread', title: 'Find me twenty agencies in Lille', status: 'awaiting_approval', kind: 'thread', unseen: false },
                { id: 'fc-general', title: 'General', status: 'idle', kind: 'general', unseen: true },
            ])
        })
    })
})
