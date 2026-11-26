import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { RemoteComputerView, RemoteJob } from '@rerun/contracts'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-script-remote-'))
process.env.RERUN_API_KEY = ''

const computers = vi.hoisted(() => ({ views: [] as RemoteComputerView[], connection: null as unknown }))
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('../remote/registry.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../remote/registry.js')>()),
    listComputerViews: async () => computers.views,
    liveConnection: () => computers.connection,
}))
vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (payload: Record<string, unknown>) => {
        sent.push(payload)
        return { delivered: true }
    },
}))

const { afterEach, beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { readJobContext } = await import('../remote/job-wake.js')
const { mkdir } = await import('node:fs/promises')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { failInterruptedRuns, getRun, startScriptRun } = await import('../db/repos/runs.js')
const { recordRemoteJob } = await import('../db/repos/remote-jobs.js')
const { abortRun, activeRunCount } = await import('../runtime/run-control.js')
const { computerRefusal, jobResult, resumeScriptJobs, runOnComputer, settleScriptJob, stopOverdueScriptJobs, SCRIPT_STOP_GRACE_MS } = await import('./script-remote.js')
const { writeSchedule } = await import('./loader.js')

const agent = { id: 'remote-scripter' } as never
const script = { runsOn: 'c1', folder: '', timeoutSec: 60, notify: 'failures' as const }

function view(patch: Partial<RemoteComputerView> = {}, settings: Partial<RemoteComputerView['settings']> = {}): RemoteComputerView {
    return {
        id: 'c1',
        handle: 'synology',
        name: 'synology',
        online: true,
        paused: false,
        connectedAt: null,
        lastSeenAt: null,
        appVersion: null,
        protocol: 1,
        capabilities: ['shell', 'jobs'],
        facts: null,
        settings: { mode: 'remember', unattended: true, allowedPrograms: ['python3'], allowedFolders: [], screenAlways: false, ...settings },
        runningJobs: 0,
        ...patch,
    }
}

function job(patch: Partial<RemoteJob> = {}): RemoteJob {
    return { id: 'j1', command: 'python3 backup.py', cwd: '/home', state: 'succeeded', exitCode: 0, startedAt: '2026-11-26T02:30:00.000Z', endedAt: '2026-11-26T02:33:00.000Z', ...patch }
}

beforeEach(() => {
    sent.length = 0
    computers.views = [view()]
    computers.connection = null
})

describe('whether a linked computer takes a script', () => {
    it('takes a program its owner always allows', () => {
        expect(computerRefusal(view(), 'python3 backup.py')).toBeNull()
    })

    it('says why it does not run, without trying', () => {
        expect(computerRefusal(view({ online: false }), 'python3 backup.py')).toMatch(/offline/)
        expect(computerRefusal(view({ paused: true }), 'python3 backup.py')).toMatch(/paused/)
        expect(computerRefusal(view({}, { unattended: false }), 'python3 backup.py')).toMatch(/without anyone there/)
        expect(computerRefusal(view(), 'rsync -a a b')).toMatch(/asks before running rsync/)
        expect(computerRefusal(view({}, { mode: 'full' }), 'rsync -a a b')).toBeNull()
    })
})

describe('the end of a job', () => {
    it('reads as the exit code of the command, and as exit 124 when the routine stopped it at its limit', () => {
        expect(jobResult(job(), 'Done.\n', null, 60)).toEqual({ exitCode: 0, output: 'Done.\n', timedOut: false, error: null })
        expect(jobResult(job({ state: 'failed', exitCode: 2 }), '', null, 60)).toMatchObject({ exitCode: 2, error: 'Exit code 2' })
        expect(jobResult(job({ state: 'stopped', exitCode: null }), '', 'limit', 300)).toMatchObject({ exitCode: 124, timedOut: true, error: 'Stopped after 5 min' })
        expect(jobResult(job({ state: 'lost', exitCode: null }), '', null, 60)).toMatchObject({ exitCode: null, error: expect.stringMatching(/quit or restarted/) })
        expect(jobResult(job({ state: 'stopped', exitCode: null }), 'half\n', 'cancel', 60)).toEqual({ exitCode: null, output: 'half\n', timedOut: false, cancelled: true, error: 'Stopped' })
    })
})

describe('a script on a linked computer', () => {
    it('fails at once, with the reason as its output, when the computer is offline', async () => {
        computers.views = [view({ online: false })]
        expect(await runOnComputer(agent, 'python3 backup.py', script, { runId: 'r0', slug: 'backup' })).toMatchObject({ exitCode: null, output: expect.stringMatching(/#synology was offline/) })
    })

    it('starts a job signed for its run, and settles it from the end the computer sends back', async () => {
        const calls: Array<{ method: string; params: Record<string, unknown> }> = []
        const connection = {
            offers: () => true,
            call: async (method: string, params: Record<string, unknown>) => {
                calls.push({ method, params })
                if (method === 'job.start') return { job: job({ state: 'running', exitCode: null, endedAt: null, context: params.context as string }) }
                if (method === 'job.logs') return { job: job(), output: 'Copied 1204 files\n', truncated: false }
                return {}
            },
        }
        computers.connection = connection
        const running = runOnComputer(agent, 'python3 backup.py', script, { runId: 'r1', slug: 'backup', name: 'Back up' })
        await vi.waitFor(() => expect(calls.map(call => call.method)).toContain('job.start'))
        const context = readJobContext(calls[0].params.context as string, 'c1')
        expect(context).toEqual({ agentId: 'remote-scripter', sessionId: '', runId: 'r1' })
        expect(calls[0].params).toMatchObject({ command: 'python3 backup.py', cwd: undefined, label: 'Back up' })

        await settleScriptJob({ ...context!, runId: 'r1' }, job(), connection as never)
        expect(await running).toEqual({ exitCode: 0, output: 'Copied 1204 files\n', timedOut: false, error: null })
    })

    it('settles the run itself when the engine restarted while the job ran', async () => {
        const run = await startScriptRun('remote-scripter', 'backup')
        const connection = { call: async () => ({ job: job(), output: 'Traceback\nOSError: disk full\n', truncated: false }) }
        await settleScriptJob({ agentId: 'remote-scripter', sessionId: '', runId: run.id }, job({ state: 'failed', exitCode: 1, label: 'Back up' }), connection as never)
        expect(await getRun('remote-scripter', run.id)).toMatchObject({ status: 'error', exitCode: 1, error: 'exit code 1: OSError: disk full' })
        expect(sent[0]).toMatchObject({ kind: 'error', message: 'Schedule "Back up" failed: exit code 1: OSError: disk full', metadata: { scheduleSlug: 'backup' } })
    })

    it('reads the routine again after a restart, so a routine that speaks on every run is not kept quiet', async () => {
        await writeSchedule('remote-scripter', { name: 'Nightly backup', body: 'python3 backup.py', cron: '0 2 * * *', kind: 'script', script: { ...script, notify: 'always' } })
        const run = await startScriptRun('remote-scripter', 'nightly-backup')
        const connection = { call: async () => ({ job: job(), output: 'Done\n', truncated: false }) }
        sent.length = 0
        await settleScriptJob({ agentId: 'remote-scripter', sessionId: '', runId: run.id }, job({ label: 'nightly-backup' }), connection as never)
        const done = sent.find(payload => payload.event === 'agent.schedule.completed')
        expect(done).toMatchObject({ kind: 'done', message: 'Schedule "Nightly backup" completed' })
        expect((done?.metadata as Record<string, unknown>).quiet).toBeUndefined()
    })
})

describe('a computer that goes quiet during a script', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('fails the run once the limit and its grace have passed, then stops the job again when the computer comes back', async () => {
        vi.useFakeTimers()
        const calls: string[] = []
        const connection = {
            offers: () => true,
            call: async (method: string) => {
                calls.push(method)
                if (method === 'job.start') return { job: job({ id: 'j9', state: 'running', exitCode: null, endedAt: null }) }
                throw new Error('disconnected')
            },
        }
        computers.connection = connection
        const running = runOnComputer(agent, 'python3 backup.py', script, { runId: 'r9', slug: 'backup' })
        await vi.advanceTimersByTimeAsync(script.timeoutSec * 1000)
        expect(calls).toContain('job.stop')
        await vi.advanceTimersByTimeAsync(SCRIPT_STOP_GRACE_MS)
        expect(await running).toMatchObject({ exitCode: null, error: expect.stringMatching(/#synology stopped answering/) })

        const stops: unknown[] = []
        stopOverdueScriptJobs('c1', { call: async (method: string, params: unknown) => void stops.push({ method, params }) } as never)
        expect(stops).toEqual([{ method: 'job.stop', params: { jobId: 'j9' } }])
        stopOverdueScriptJobs('other', { call: async () => stops.push('wrong') } as never)
        expect(stops).toHaveLength(1)
    })

    it('still reads a late end as stopped at the limit', async () => {
        vi.useFakeTimers()
        const connection = {
            offers: () => true,
            call: async (method: string) => {
                if (method === 'job.start') return { job: job({ id: 'j10', state: 'running', exitCode: null, endedAt: null }) }
                if (method === 'job.logs') return { job: job(), output: '', truncated: false }
                throw new Error('disconnected')
            },
        }
        computers.connection = connection
        const run = await startScriptRun('remote-scripter', 'backup')
        const running = runOnComputer(agent, 'python3 backup.py', script, { runId: run.id, slug: 'backup' })
        await vi.advanceTimersByTimeAsync(script.timeoutSec * 1000 + SCRIPT_STOP_GRACE_MS)
        await running
        vi.useRealTimers()
        await settleScriptJob({ agentId: 'remote-scripter', sessionId: '', runId: run.id }, job({ id: 'j10', state: 'stopped', exitCode: null }), connection as never)
        expect(await getRun('remote-scripter', run.id)).toMatchObject({ status: 'error', exitCode: 124, error: 'Stopped after 1 min' })
    })
})

describe('a script on a linked computer whose run is cancelled', () => {
    it('stops its job, and ends cancelled with what the job printed', async () => {
        const calls: string[] = []
        const connection = {
            offers: () => true,
            call: async (method: string) => {
                calls.push(method)
                if (method === 'job.start') return { job: job({ id: 'j20', state: 'running', exitCode: null, endedAt: null }) }
                if (method === 'job.logs') return { job: job(), output: 'Copied 12 files\n', truncated: false }
                return { job: job({ id: 'j20', state: 'stopped', exitCode: null }) }
            },
        }
        computers.connection = connection
        const abort = new AbortController()
        const running = runOnComputer(agent, 'python3 backup.py', script, { runId: 'r20', slug: 'backup', abort: abort.signal })
        await vi.waitFor(() => expect(calls).toContain('job.start'))
        await new Promise(next => setImmediate(next))
        abort.abort()
        await vi.waitFor(() => expect(calls).toContain('job.stop'))
        await settleScriptJob({ agentId: 'remote-scripter', sessionId: '', runId: 'r20' }, job({ id: 'j20', state: 'stopped', exitCode: null }), connection as never)
        expect(await running).toEqual({ exitCode: null, output: 'Copied 12 files\n', timedOut: false, cancelled: true, error: 'Stopped' })
    })

    it('does not wait for a computer that went away: it ends cancelled at once, and the job is stopped when the computer comes back', async () => {
        const connection = { offers: () => true, call: async () => ({ job: job({ id: 'j21', state: 'running', exitCode: null, endedAt: null }) }) }
        computers.connection = connection
        const abort = new AbortController()
        const running = runOnComputer(agent, 'python3 backup.py', script, { runId: 'r21', slug: 'backup', abort: abort.signal })
        await new Promise(next => setTimeout(next, 20))
        computers.connection = null
        abort.abort()
        expect(await running).toMatchObject({ cancelled: true, exitCode: null })
        const stops: unknown[] = []
        stopOverdueScriptJobs('c1', { call: async (method: string, params: unknown) => void stops.push({ method, params }) } as never)
        expect(stops).toContainEqual({ method: 'job.stop', params: { jobId: 'j21' } })
    })
})

describe('a job still out on its computer when the engine restarts', () => {
    const id = 'remote-scripter'

    beforeAll(async () => {
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'remote scripter' }))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps its run running, where a run with no job out is failed as interrupted', async () => {
        const withJob = await startScriptRun(id, 'backup')
        const local = await startScriptRun(id, 'backup')
        await recordRemoteJob(id, '', 'c1', job({ id: 'j30', state: 'running', exitCode: null, endedAt: null }), withJob.id)
        const failed = await failInterruptedRuns(id, { keepOpenScriptJobs: true })
        expect(failed.map(run => run.id)).toEqual([local.id])
        expect(await getRun(id, withJob.id)).toMatchObject({ status: 'running' })
        expect(await getRun(id, local.id)).toMatchObject({ status: 'error', error: 'interrupted: engine restarted' })

        expect((await failInterruptedRuns(id)).map(run => run.id)).toEqual([withJob.id])
    })

    it('is live again with what is left of its limit, and is stopped when that runs out', async () => {
        await writeSchedule(id, { name: 'Backup', body: 'python3 backup.py', cron: '0 2 * * *', kind: 'script', script })
        const run = await startScriptRun(id, 'backup')
        await recordRemoteJob(id, '', 'c1', job({ id: 'j31', state: 'running', exitCode: null, endedAt: null }), run.id)
        const calls: Array<{ method: string; params: unknown }> = []
        const connection = {
            call: async (method: string, params: unknown) => {
                calls.push({ method, params })
                return method === 'job.logs' ? { job: job(), output: '', truncated: false } : {}
            },
        }
        computers.connection = connection
        vi.useFakeTimers()
        const started = Date.parse(run.startedAt)
        expect(await resumeScriptJobs(started + 40_000)).toBe(1)
        expect(activeRunCount()).toBe(1)

        await vi.advanceTimersByTimeAsync(19_000)
        expect(calls).toEqual([])
        await vi.advanceTimersByTimeAsync(1_000)
        expect(calls).toEqual([{ method: 'job.stop', params: { jobId: 'j31' } }])
        vi.useRealTimers()

        sent.length = 0
        await settleScriptJob({ agentId: id, sessionId: '', runId: run.id }, job({ id: 'j31', state: 'stopped', exitCode: null }), connection as never)
        await vi.waitFor(async () => expect(await getRun(id, run.id)).toMatchObject({ status: 'error', exitCode: 124, error: 'Stopped after 1 min' }))
        await vi.waitFor(() => expect(activeRunCount()).toBe(0))
        expect(sent.filter(payload => payload.event === 'agent.schedule.completed')).toHaveLength(1)
    })

    it('ends its run with what really happened, and can be cancelled meanwhile', async () => {
        const done = await startScriptRun(id, 'backup')
        const stopped = await startScriptRun(id, 'backup')
        await recordRemoteJob(id, '', 'c1', job({ id: 'j32', state: 'running', exitCode: null, endedAt: null }), done.id)
        await recordRemoteJob(id, '', 'c1', job({ id: 'j33', state: 'running', exitCode: null, endedAt: null }), stopped.id)
        const calls: string[] = []
        const connection = {
            call: async (method: string, params: { jobId: string }) => {
                calls.push(`${method}:${params.jobId}`)
                return method === 'job.logs' ? { job: job(), output: 'Done\n', truncated: false } : {}
            },
        }
        computers.connection = connection
        expect(await resumeScriptJobs()).toBe(2)

        await settleScriptJob({ agentId: id, sessionId: '', runId: done.id }, job({ id: 'j32' }), connection as never)
        await vi.waitFor(async () => expect(await getRun(id, done.id)).toMatchObject({ status: 'done', exitCode: 0, scriptOutput: 'Done\n' }))

        const cancelling = abortRun(stopped.id)
        await vi.waitFor(() => expect(calls).toContain('job.stop:j33'))
        await settleScriptJob({ agentId: id, sessionId: '', runId: stopped.id }, job({ id: 'j33', state: 'stopped', exitCode: null }), connection as never)
        await cancelling
        expect(await getRun(id, stopped.id)).toMatchObject({ status: 'cancelled' })
    })
})
