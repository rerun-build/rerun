import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-foreman-wake-'))
process.env.RERUN_HUB_BASE_URL = 'https://hub.test'
process.env.RERUN_API_KEY = 'box-key'

const state = vi.hoisted(() => ({
    hubAnswer: null as unknown,
    hubStatus: 200,
    hubCalls: [] as Array<{ url: string; headers: Record<string, string>; body: { tool: string; args: Record<string, unknown> } }>,
    started: [] as Array<{ agent: { brief?: unknown; config: { tools: Record<string, boolean> } }; sessionId: string; message: string; trigger: unknown; runId?: string }>,
    sent: [] as Array<Record<string, unknown>>,
    live: false,
    provider: 'claude' as string,
    usable: true,
}))

vi.mock('../runtime/headless-run.js', () => ({
    startHeadlessRun: async (agent: never, sessionId: string, message: string, _override: unknown, trigger: unknown, runId?: string) => {
        state.started.push({ agent, sessionId, message, trigger, runId })
        return { runId: runId ?? 'run-x', settled: Promise.resolve() }
    },
}))
vi.mock('../runtime/notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('../runtime/notify.js')>()), sendNotification: async (input: Record<string, unknown>) => (state.sent.push(input), { delivered: true }) }))
vi.mock('../runtime/run-control.js', async importOriginal => ({ ...(await importOriginal<typeof import('../runtime/run-control.js')>()), agentHasLiveRun: () => state.live }))
vi.mock('../agents/availability.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../agents/availability.js')>()),
    resolveAutomationModel: async () => ({ provider: state.provider, model: 'm' }),
    resolveRunModel: async () => ({ connection: null, provider: state.provider, model: 'm' }),
    isUsable: () => state.usable,
}))

vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    state.hubCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(state.hubAnswer), { status: state.hubStatus })
})

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { FOREMAN_WAKE_MARKER } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { listSessions } = await import('../db/repos/sessions.js')
const { sessionClaim } = await import('../runtime/run-control.js')
const { startForemanWake } = await import('./wake-run.js')

const BRIEF = { brief: { instructions: 'Charter of a wake', tools: [], builtins: [], hubToken: 'wake-token' }, memberId: 'member-1', timezone: 'Europe/Paris' }

beforeAll(async () => {
    await migrate()
    await ensureForeman()
})

beforeEach(() => {
    state.hubAnswer = BRIEF
    state.hubStatus = 200
    state.hubCalls.length = 0
    state.started.length = 0
    state.sent.length = 0
    state.live = false
    state.provider = 'claude'
    state.usable = true
})

describe('startForemanWake', () => {
    it('asks the hub on the box key alone, then runs in a session of its own, claimed, as the member the hub chose', async () => {
        const outcome = await startForemanWake({ reason: 'Your daily check-in.', memberId: 'member-9', lastWakeAt: '2026-11-15T09:00:00Z' })
        expect(outcome.status).toBe('started')
        const [call] = state.hubCalls
        expect(call.url).toBe('https://hub.test/api/hub')
        expect(call.headers).toMatchObject({ Authorization: 'Bearer box-key', 'x-rerun-agent': 'foreman' })
        expect(call.headers).not.toHaveProperty('x-rerun-foreman-token')
        expect(call.body).toEqual({ tool: 'foreman_brief', args: { reason: 'Your daily check-in.', memberId: 'member-9', provider: 'claude', lastWakeAt: '2026-11-15T09:00:00Z' } })

        const [run] = state.started
        expect(run.trigger).toEqual({ source: 'wake', reason: 'Your daily check-in.', memberId: 'member-1' })
        expect(run.message.startsWith(FOREMAN_WAKE_MARKER)).toBe(true)
        expect(run.agent.brief).toEqual(BRIEF.brief)
        expect(sessionClaim(run.sessionId)?.runId).toBe(run.runId)
        const session = (await listSessions('foreman')).find(row => row.id === run.sessionId)
        expect(session?.source).toBe('wake')
        expect(state.sent[0]).toMatchObject({ event: 'agent.session.created', source: 'wake', metadata: { memberId: 'member-1' } })
    })

    // Even what the hub would hand out cannot reach the web or write through these families.
    it('builds no shell, web, browser or sub-coworker for the run', async () => {
        await startForemanWake({ reason: 'x' })
        const { tools } = state.started[0].agent.config
        expect(tools).toMatchObject({ shell: false, web: false, browser: false, delegate: false, callAgent: false })
    })

    it('stays asleep for the reason the hub gives', async () => {
        state.hubAnswer = { skip: 'not_released' }
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'skipped', reason: 'not_released' })
        expect(state.started).toHaveLength(0)
    })

    it('waits when the hub is unreachable or predates wakes', async () => {
        state.hubStatus = 502
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'deferred', reason: 'hub_unreachable' })
        state.hubStatus = 200
        state.hubAnswer = { error: 'Unknown foreman tool: foreman_brief' }
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'deferred', reason: 'hub_unreachable' })
        expect(state.started).toHaveLength(0)
    })

    it('waits for a conversation in flight to end, and for a model it can run on', async () => {
        state.live = true
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'deferred', reason: 'busy' })
        state.live = false
        state.usable = false
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'deferred', reason: 'no_model' })
        expect(state.hubCalls).toHaveLength(0)
    })

    it('never wakes on Codex, whatever the hub would say', async () => {
        state.provider = 'codex'
        expect(await startForemanWake({ reason: 'x' })).toEqual({ status: 'skipped', reason: 'provider' })
        expect(state.hubCalls).toHaveLength(0)
    })
})
