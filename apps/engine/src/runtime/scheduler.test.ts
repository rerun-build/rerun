import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-scheduler-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

type Outcome = { kind: 'done' | 'error' | 'cancelled'; error?: string; awaitingHuman?: boolean }

const state = vi.hoisted(() => ({
    agents: {} as Record<string, { id: string; config: { enabled: boolean } } | Error>,
    agentIds: [] as string[] | Error,
    schedules: {} as Record<string, unknown[] | Error>,
    due: new Set<string>(),
    provider: 'rerun' as string,
    connectionId: undefined as string | undefined,
    computer: true,
    liveRuns: false,
    liveRunIds: [] as string[],
    launchError: null as Error | null,
    sent: [] as Array<Record<string, unknown>>,
    runs: [] as Array<{ agentId: string; sessionId: string; message: string; override: unknown; trigger: unknown; runId: string; finish: (o: Outcome) => void }>,
    markFired: vi.fn(async (_agentId: string, _slug: string, _at: string) => {}),
    deleteFiredOneOff: vi.fn(async (_agentId: string, _fired: { slug: string }, _at: string): Promise<boolean> => true),
    sweep: vi.fn(async (_ids: string[]) => {}),
    sessions: 0,
    promisesToday: 0,
    checkinRunning: false,
    promiseLatch: null as Error | null,
    checkins: [] as Array<{ reason: string; slug?: string }>,
    announce: vi.fn(async () => {}),
    pulse: vi.fn(async () => {}),
}))

vi.mock('../checkins/pulse.js', () => ({ runPulseIfDue: state.pulse }))

vi.mock('../checkins/run.js', () => ({
    PROMISE_DAILY_CAP: 3,
    promisesInLastDay: async () => state.promisesToday,
    checkinInFlight: () => state.checkinRunning,
    refuseLatchedCheckin: async () => {
        if (state.promiseLatch) throw state.promiseLatch
    },
    startCheckin: async (reason: string, schedule?: { slug: string }) => {
        state.checkins.push({ reason, slug: schedule?.slug })
        return { runId: 'checkin-run', sessionId: 'checkin-session' }
    },
}))
vi.mock('../checkins/settle.js', () => ({ announcePendingCheckins: state.announce }))

vi.mock('../agents/availability.js', () => ({
    automationModel: async (_agent: unknown, schedule: { model?: string | null }) => ({ provider: state.provider, model: schedule.model ?? 'm', ...(state.connectionId ? { connectionId: state.connectionId } : {}) }),
}))
vi.mock('../tools/builtin/computer.js', () => ({ offersComputer: () => state.computer }))
vi.mock('../agents/loader.js', () => ({
    listAgentIdsOnDisk: async () => {
        if (state.agentIds instanceof Error) throw state.agentIds
        return state.agentIds
    },
}))
vi.mock('../agents/registry.js', () => ({
    getAgent: async (id: string) => {
        const agent = state.agents[id]
        if (!agent || agent instanceof Error) throw agent ?? new Error(`no agent ${id}`)
        return agent
    },
}))
vi.mock('../db/repos/sessions.js', () => ({
    createSession: async (_agentId: string, title: string, _origin: unknown, source: string) => ({ id: `sess-${++state.sessions}`, title, source }),
}))
vi.mock('../schedules/loader.js', () => ({
    listSchedules: async (agentId: string) => {
        const list = state.schedules[agentId] ?? []
        if (list instanceof Error) throw list
        return list
    },
    markFired: state.markFired,
    deleteFiredOneOff: state.deleteFiredOneOff,
}))
vi.mock('../schedules/cron.js', () => ({
    isDue: (schedule: { slug: string }) => state.due.has(schedule.slug),
}))
vi.mock('../memory/maintenance.js', () => ({ sweepMemoriesIfDue: state.sweep }))
const backupFree = vi.hoisted(() => ({ value: false }))
vi.mock('../agents/backups.js', () => ({ pickBackup: async () => (backupFree.value ? { connection: { id: 'codex-sub' }, provider: 'codex', model: 'gpt-6-sol' } : null) }))
vi.mock('./notify.js', () => ({
    sendNotification: async (input: Record<string, unknown>) => {
        state.sent.push(input)
        return { delivered: true }
    },
}))
vi.mock('./headless-run.js', async () => {
    const { registerRunAbort, unregisterRunAbort } = await import('./run-control.js')
    return {
        startHeadlessRun: async (agent: { id: string }, sessionId: string, message: string, override: unknown, trigger: unknown) => {
            if (state.launchError) {
                const err = state.launchError
                state.launchError = null
                throw err
            }
            let finish!: (o: Outcome) => void
            const settled = new Promise<Outcome>(r => (finish = r))
            const runId = `run-${state.runs.length + 1}`
            // The real run registers itself before `startHeadlessRun` hands back, and unregisters
            // itself as it settles.
            if (state.liveRuns) {
                registerRunAbort(runId, agent.id)
                state.liveRunIds.push(runId)
                void settled.finally(() => unregisterRunAbort(runId))
            }
            state.runs.push({ agentId: agent.id, sessionId, message, override, trigger, runId, finish })
            return { runId, settled }
        },
    }
})

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { fireSchedule, startScheduler } = await import('./scheduler.js')
const { armBudgetLatch, clearBudgetLatch } = await import('./budget-latch.js')
const { armPlanLimitLatch, clearPlanLimitLatch } = await import('../connections/plan-limits.js')
const { registerRunAbort, unregisterRunAbort } = await import('./run-control.js')
const { HttpError } = await import('../lib/errors.js')
const { logger } = await import('../lib/logger.js')
type Schedule = import('../schedules/loader.js').Schedule

function schedule(slug: string, extra: Partial<Schedule> = {}): Schedule {
    return { slug, name: `Name ${slug}`, description: '', enabled: true, cron: '* * * * *', runAt: null, timezone: null, lastRunAt: null, connectionId: null, provider: null, model: null, checkIn: false, body: `do ${slug}`, createdAt: '2026-01-01T00:00:00.000Z', ...extra }
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
    state.agents = { on: { id: 'on', config: { enabled: true } }, off: { id: 'off', config: { enabled: false } } }
    state.agentIds = []
    state.schedules = {}
    state.due = new Set()
    state.provider = 'rerun'
    state.connectionId = undefined
    state.computer = true
    state.liveRuns = false
    state.launchError = null
    state.promisesToday = 0
    state.checkinRunning = false
    state.promiseLatch = null
    state.checkins = []
})

afterEach(async () => {
    for (const run of state.runs) run.finish({ kind: 'done' })
    await flush()
    state.runs = []
    state.sent = []
    state.markFired.mockClear()
    state.deleteFiredOneOff.mockReset()
    state.deleteFiredOneOff.mockImplementation(async () => true)
    state.sweep.mockClear()
    state.announce.mockClear()
    state.pulse.mockClear()
    clearBudgetLatch()
    clearPlanLimitLatch('claude-sub')
    backupFree.value = false
    unregisterRunAbort('live-call')
    for (const runId of state.liveRunIds.splice(0)) unregisterRunAbort(runId)
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('fireSchedule', () => {
    it('refuses a switched-off agent with a 403', async () => {
        await expect(fireSchedule('off', schedule('s'))).rejects.toMatchObject({ status: 403 })
        expect(state.runs).toHaveLength(0)
    })

    it('skips a managed-model run while the budget latch is armed, leaving the schedule due', async () => {
        armBudgetLatch()

        const err = await fireSchedule('on', schedule('latched')).catch(e => e)

        expect(err).toBeInstanceOf(HttpError)
        expect(err.status).toBe(402)
        expect(state.markFired).not.toHaveBeenCalled()
        expect(state.sent).toHaveLength(0)
        expect(state.runs).toHaveLength(0)
    })

    it('fires through the latch when asked to ignore it', async () => {
        armBudgetLatch()

        await fireSchedule('on', schedule('forced'), { manual: true })

        expect(state.runs).toHaveLength(1)
    })

    it('still fires an agent on its own key while the latch is armed', async () => {
        armBudgetLatch()
        state.provider = 'openai'

        await fireSchedule('on', schedule('own-key'))

        expect(state.runs).toHaveLength(1)
        expect(state.runs[0].override).toEqual({ provider: 'openai', model: 'm' })
    })

    // A coworker called by another one at 15:28 had not touched its screen yet when its 15:30
    // schedule fired, took the screen first, and left the called run with nothing to drive.
    it('leaves the schedule due while another run of a coworker with a screen is live', async () => {
        registerRunAbort('live-call', 'on')

        const err = await fireSchedule('on', schedule('busy')).catch(e => e)

        expect(err).toBeInstanceOf(HttpError)
        expect(err.status).toBe(409)
        expect(state.markFired).not.toHaveBeenCalled()
        expect(state.sent).toHaveLength(0)
        expect(state.runs).toHaveLength(0)

        unregisterRunAbort('live-call')
        await fireSchedule('on', schedule('busy'))
        expect(state.runs).toHaveLength(1)
    })

    it('fires beside a live run when the coworker has no screen to fight over', async () => {
        registerRunAbort('live-call', 'on')
        state.computer = false

        await fireSchedule('on', schedule('no-screen'))

        expect(state.runs).toHaveLength(1)
    })

    it('leaves the schedule due while its subscription is spent, and fires once it resets', async () => {
        state.provider = 'claude'
        state.connectionId = 'claude-sub'
        const now = Date.now()
        armPlanLimitLatch('claude-sub', now)

        const err = await fireSchedule('on', schedule('spent')).catch(e => e)

        expect(err).toBeInstanceOf(HttpError)
        expect(err.status).toBe(429)
        expect(state.markFired).not.toHaveBeenCalled()
        expect(state.runs).toHaveLength(0)

        state.connectionId = 'other-sub'
        await fireSchedule('on', schedule('other-connection'))
        expect(state.runs).toHaveLength(1)

        state.connectionId = 'claude-sub'
        vi.useFakeTimers({ now: now + 31 * 60_000, toFake: ['Date'] })
        await fireSchedule('on', schedule('spent'))
        expect(state.runs).toHaveLength(2)
    })

    // The run itself moves to the backup: the schedule only has to stop holding it back.
    it('fires while its subscription is spent when a backup is free', async () => {
        state.provider = 'claude'
        state.connectionId = 'claude-sub'
        armPlanLimitLatch('claude-sub')
        backupFree.value = true

        await fireSchedule('on', schedule('spent-with-backup'))

        expect(state.runs).toHaveLength(1)
    })

    it('fires a manual run through every latch', async () => {
        armBudgetLatch()
        registerRunAbort('live-call', 'on')
        state.connectionId = 'claude-sub'
        armPlanLimitLatch('claude-sub')

        await fireSchedule('on', schedule('manual-probe'), { manual: true })

        expect(state.runs).toHaveLength(1)
    })

    it('stamps the schedule, opens a schedule session, announces it and starts the run', async () => {
        const started = await fireSchedule('on', schedule('daily', { model: 'gpt-x' }))

        expect(state.markFired).toHaveBeenCalledWith('on', 'daily', expect.any(String))
        expect(state.sent).toEqual([
            { event: 'agent.session.created', kind: 'info', agentId: 'on', sessionId: started.sessionId, runId: null, message: 'Scheduled run: Name daily', title: 'Name daily', source: 'schedule' },
        ])
        expect(state.runs[0]).toMatchObject({ agentId: 'on', sessionId: started.sessionId, message: '<scheduled_run schedule="daily" name="Name daily">\ndo daily\n</scheduled_run>', override: { provider: 'rerun', model: 'gpt-x' }, trigger: { source: 'schedule', slug: 'daily', name: 'Name daily' } })
        expect(started.runId).toBe(state.runs[0].runId)
    })

    it('does not stamp the schedule when told not to', async () => {
        await fireSchedule('on', schedule('manual'), { markFired: false })

        expect(state.markFired).not.toHaveBeenCalled()
        expect(state.runs).toHaveLength(1)
    })

    it('hands back the run already in flight instead of starting a second one', async () => {
        const first = await fireSchedule('on', schedule('dedupe'))
        const second = await fireSchedule('on', schedule('dedupe'))

        expect(second).toEqual(first)
        expect(state.runs).toHaveLength(1)
        expect(state.markFired).toHaveBeenCalledTimes(1)
    })

    it('fires again once the previous run has settled, even on error', async () => {
        vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        const first = await fireSchedule('on', schedule('again'))
        state.runs[0].finish({ kind: 'error', error: 'boom' })
        await flush()

        const second = await fireSchedule('on', schedule('again'))

        expect(second.runId).not.toBe(first.runId)
        expect(state.runs).toHaveLength(2)
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ schedule: 'again', err: 'boom' }), 'scheduled run failed')
    })

    it('deletes a one-off once its run is done, as it was fired and at the stamp it was fired with', async () => {
        const once = schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' })
        await fireSchedule('on', once)
        expect(state.deleteFiredOneOff).not.toHaveBeenCalled()

        state.runs[0].finish({ kind: 'done' })
        await flush()

        const firedAt = state.markFired.mock.calls[0][2]
        expect(state.deleteFiredOneOff).toHaveBeenCalledWith('on', once, firedAt)
    })

    it('keeps a one-off whose run stopped on a question', async () => {
        await fireSchedule('on', schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' }))
        state.runs[0].finish({ kind: 'done', awaitingHuman: true })
        await flush()

        expect(state.deleteFiredOneOff).not.toHaveBeenCalled()
    })

    it.each(['error', 'cancelled'] as const)('keeps a one-off whose run ended %s', async kind => {
        vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        await fireSchedule('on', schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' }))
        state.runs[0].finish({ kind, error: 'boom' })
        await flush()

        expect(state.deleteFiredOneOff).not.toHaveBeenCalled()
    })

    it('never deletes a cron, nor a one-off run by hand', async () => {
        await fireSchedule('on', schedule('daily'))
        await fireSchedule('on', schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' }), { markFired: false, manual: true })
        for (const run of state.runs) run.finish({ kind: 'done' })
        await flush()

        expect(state.deleteFiredOneOff).not.toHaveBeenCalled()
    })

    it('frees the schedule even when the delete throws', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
        state.deleteFiredOneOff.mockImplementation(async () => {
            throw new Error('disk gone')
        })
        const first = await fireSchedule('on', schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' }))
        state.runs[0].finish({ kind: 'done' })
        await flush()

        const second = await fireSchedule('on', schedule('once', { cron: null, runAt: '2026-10-01T00:00:00.000Z' }))
        expect(second.runId).not.toBe(first.runId)
        expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ schedule: 'once', err: 'Error: disk gone' }), 'one-off schedule delete failed')
    })

    it('does not collapse two calls racing before the first run has started', async () => {
        const [a, b] = await Promise.all([fireSchedule('on', schedule('race')), fireSchedule('on', schedule('race'))])

        // Looks wrong: the in-flight entry is only set after startHeadlessRun resolves, so concurrent callers both fire.
        expect(a.runId).not.toBe(b.runId)
        expect(state.runs).toHaveLength(2)
    })
})

describe('fireSchedule on a promise of the Chief of Staff', () => {
    beforeEach(() => {
        state.agents.foreman = { id: 'foreman', config: { enabled: true, kind: 'foreman' } } as never
    })

    it('wakes it in a check-in for that promise, with no scheduled run and no session announced', async () => {
        expect(await fireSchedule('foreman', schedule('come-back', { checkIn: true }))).toEqual({ runId: 'checkin-run', sessionId: 'checkin-session' })
        expect(state.checkins).toEqual([{ reason: 'promise', slug: 'come-back' }])
        expect(state.markFired).toHaveBeenCalledWith('foreman', 'come-back', expect.any(String))
        expect(state.runs).toEqual([])
        expect(state.sent).toEqual([])
    })

    it('spends the occurrence without waking it once the promises of the day are used up', async () => {
        state.promisesToday = 3
        await expect(fireSchedule('foreman', schedule('come-back', { checkIn: true }))).rejects.toMatchObject({ code: 'promise_cap' })
        expect(state.markFired).toHaveBeenCalledTimes(1)
        expect(state.checkins).toEqual([])
    })

    it('still wakes it past the cap when someone pressed Run now', async () => {
        state.promisesToday = 3
        await fireSchedule('foreman', schedule('come-back', { checkIn: true }), { manual: true })
        expect(state.checkins).toEqual([{ reason: 'promise', slug: 'come-back' }])
    })

    it('leaves it due while another check-in runs, which would never read what was promised', async () => {
        state.checkinRunning = true
        await expect(fireSchedule('foreman', schedule('come-back', { checkIn: true }))).rejects.toMatchObject({ code: 'checkin_busy' })
        expect(state.markFired).not.toHaveBeenCalled()
        expect(state.checkins).toEqual([])
    })

    it('leaves it due while the credit is out, unless someone pressed Run now', async () => {
        state.promiseLatch = Object.assign(new Error('Rerun credits used up'), { code: 'budget_latched' })
        await expect(fireSchedule('foreman', schedule('come-back', { checkIn: true }))).rejects.toMatchObject({ code: 'budget_latched' })
        expect(state.markFired).not.toHaveBeenCalled()
        await fireSchedule('foreman', schedule('come-back', { checkIn: true }), { manual: true })
        expect(state.checkins).toEqual([{ reason: 'promise', slug: 'come-back' }])
    })

    it('runs its other routines, and a coworker asking for a check-in, as before', async () => {
        await fireSchedule('foreman', schedule('weekly'))
        await fireSchedule('on', schedule('sneaky', { checkIn: true }))
        expect(state.checkins).toEqual([])
        expect(state.runs.map(run => run.agentId)).toEqual(['foreman', 'on'])
    })
})

describe('startScheduler', () => {
    it('ticks at once and then every 30 seconds until stopped', async () => {
        vi.useFakeTimers()
        state.agentIds = ['on']

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        expect(state.sweep).toHaveBeenCalledTimes(1)
        expect(state.sweep).toHaveBeenCalledWith(['on'])

        await vi.advanceTimersByTimeAsync(30_000)
        expect(state.sweep).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(state.sweep).toHaveBeenCalledTimes(3)

        stop()
        await vi.advanceTimersByTimeAsync(90_000)
        expect(state.sweep).toHaveBeenCalledTimes(3)
        // The check-ins whose thread the hub did not hear yet are told again on every tick.
        expect(state.announce).toHaveBeenCalledTimes(3)
        expect(state.pulse).toHaveBeenCalledTimes(3)
    })

    it('fires only the due schedules of enabled agents', async () => {
        vi.useFakeTimers()
        state.agentIds = ['on', 'off', 'missing']
        state.schedules = { on: [schedule('due-a'), schedule('not-due')], off: [schedule('due-off')] }
        state.due = new Set(['due-a', 'due-off'])

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(state.runs.map(r => (r.trigger as { slug: string }).slug)).toEqual(['due-a'])
    })

    it('keeps ticking the other agents when one fails to list its schedules', async () => {
        vi.useFakeTimers()
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        state.agents.second = { id: 'second', config: { enabled: true } }
        state.agentIds = ['on', 'second']
        state.schedules = { on: new Error('bad frontmatter'), second: [schedule('second-due')] }
        state.due = new Set(['second-due'])

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(state.runs.map(r => r.agentId)).toEqual(['second'])
        expect(errors).toHaveBeenCalledWith(expect.objectContaining({ agent: 'on', err: 'Error: bad frontmatter' }), 'scheduler failed to load schedules')
    })

    it('logs a tick that cannot list the agents and tries again on the next one', async () => {
        vi.useFakeTimers()
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        state.agentIds = new Error('disk gone')

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        expect(errors).toHaveBeenCalledWith({ err: 'Error: disk gone' }, 'scheduler tick failed to list agents')
        expect(state.sweep).not.toHaveBeenCalled()

        state.agentIds = ['on']
        await vi.advanceTimersByTimeAsync(30_000)
        stop()
        expect(state.sweep).toHaveBeenCalledWith(['on'])
    })

    it('treats a budget skip as routine and a launch failure as an error', async () => {
        vi.useFakeTimers()
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined as never)
        state.agentIds = ['on']
        state.schedules = { on: [schedule('skipped')] }
        state.due = new Set(['skipped'])
        armBudgetLatch()

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        expect(debug).toHaveBeenCalledWith({ agent: 'on', schedule: 'skipped' }, 'scheduled run skipped: rerun budget latched')
        expect(errors).not.toHaveBeenCalled()

        clearBudgetLatch()
        state.markFired.mockRejectedValueOnce(new Error('read-only fs'))
        await vi.advanceTimersByTimeAsync(30_000)
        stop()
        expect(errors).toHaveBeenCalledWith({ agent: 'on', schedule: 'skipped', err: 'Error: read-only fs' }, 'scheduled run failed')
    })

    it('treats a busy coworker and a spent subscription as routine skips', async () => {
        vi.useFakeTimers()
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined as never)
        state.agentIds = ['on']
        state.schedules = { on: [schedule('held')] }
        state.due = new Set(['held'])
        registerRunAbort('live-call', 'on')

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        expect(debug).toHaveBeenCalledWith({ agent: 'on', schedule: 'held' }, 'scheduled run skipped: another run of the coworker is live')

        unregisterRunAbort('live-call')
        state.connectionId = 'claude-sub'
        armPlanLimitLatch('claude-sub')
        await vi.advanceTimersByTimeAsync(30_000)
        expect(debug).toHaveBeenCalledWith({ agent: 'on', schedule: 'held' }, 'scheduled run skipped: subscription limit latched')

        clearPlanLimitLatch('claude-sub')
        await vi.advanceTimersByTimeAsync(30_000)
        stop()
        expect(errors).not.toHaveBeenCalled()
        expect(state.runs).toHaveLength(1)
    })

    it('fires the schedules of one coworker one after the other when two are due together', async () => {
        vi.useFakeTimers()
        const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined as never)
        state.liveRuns = true
        state.agentIds = ['on']
        state.schedules = { on: [schedule('first'), schedule('second')] }
        state.due = new Set(['first', 'second'])

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        expect(state.runs.map(r => (r.trigger as { slug: string }).slug)).toEqual(['first'])
        expect(state.markFired).toHaveBeenCalledTimes(1)
        expect(debug).toHaveBeenCalledWith({ agent: 'on', schedule: 'second' }, 'scheduled run skipped: another run of the coworker is live')

        state.due.delete('first')
        state.runs[0].finish({ kind: 'done' })
        await vi.advanceTimersByTimeAsync(30_000)
        stop()
        expect(state.runs.map(r => (r.trigger as { slug: string }).slug)).toEqual(['first', 'second'])
    })

    it('still fails loudly on a conflict the launch raises without a hold code', async () => {
        vi.useFakeTimers()
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never)
        const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined as never)
        state.agentIds = ['on']
        state.schedules = { on: [schedule('plain')] }
        state.due = new Set(['plain'])
        state.launchError = new HttpError(409, 'session already claimed')

        const stop = startScheduler()
        await vi.advanceTimersByTimeAsync(0)
        stop()
        expect(errors).toHaveBeenCalledWith({ agent: 'on', schedule: 'plain', err: 'HttpError: session already claimed' }, 'scheduled run failed')
        expect(debug).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('scheduled run skipped'))
    })
})
