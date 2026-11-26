import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-script-run-'))
process.env.RERUN_API_KEY = ''

const notified = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (payload: Record<string, unknown>) => {
        notified.push(payload)
        return { delivered: true }
    },
}))
vi.mock('../vault/runtime.js', async importOriginal => ({ ...(await importOriginal<typeof import('../vault/runtime.js')>()), vaultEnvFor: () => ({}) }))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { sharedDir } = await import('../config/paths.js')
const { getRun, listRunsByAgent } = await import('../db/repos/runs.js')
const { abortRun, activeRunCount, agentHasLiveRun } = await import('../runtime/run-control.js')
const { writeSchedule, readSchedule } = await import('./loader.js')
const { fireScript, runShellCommand, scriptFolderPath, isValidScriptFolder } = await import('./script-run.js')
const { SCRIPT_OUTPUT_CUT_MARK, SCRIPT_OUTPUT_MAX_CHARS, failureText } = await import('./script-result.js')

const agent = { id: 'scripter', env: {}, hubAgentId: null, config: { tools: { sharedDb: false }, vault: [], mcpServers: [] } } as never
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' }

// What the hub hears of a run, beside the "routine created" every new routine sends.
const sent = { get list() { return notified.filter(payload => payload.event === 'agent.schedule.completed') } }

beforeEach(() => {
    notified.length = 0
})

describe('running a command', () => {
    it('keeps what it printed on both streams, in order, and its exit code', async () => {
        const result = await runShellCommand({ command: 'echo one; echo two >&2; exit 3', cwd: tmpdir(), env, timeoutMs: 10_000 })
        expect(result).toMatchObject({ exitCode: 3, timedOut: false, error: 'Exit code 3' })
        expect(result.output).toBe('one\ntwo\n')
    })

    it('succeeds with exit code 0 and no error', async () => {
        expect(await runShellCommand({ command: 'printf ok', cwd: tmpdir(), env, timeoutMs: 10_000 })).toEqual({ exitCode: 0, output: 'ok', timedOut: false, error: null })
    })

    it('stops a command at its limit, with what it started, as exit 124', async () => {
        const started = Date.now()
        const result = await runShellCommand({ command: 'echo waiting; sleep 30 & sleep 30', cwd: tmpdir(), env, timeoutMs: 300 })
        expect(result).toMatchObject({ exitCode: 124, timedOut: true, output: 'waiting\n' })
        expect(Date.now() - started).toBeLessThan(5_000)
    })

    it('kills at its limit what ignored the stop, once the shell that started it is gone', async () => {
        const result = await runShellCommand({ command: `(trap "" TERM; exec sh -c 'echo $$; exec sleep 25') & wait`, cwd: tmpdir(), env, timeoutMs: 300 })
        expect(result).toMatchObject({ exitCode: 124, timedOut: true })
        const survivor = Number(result.output.trim())
        expect(survivor).toBeGreaterThan(0)
        await vi.waitFor(() => expect(() => process.kill(survivor, 0)).toThrow())
    })

    it('is stopped by a cancel, which is neither its limit nor a failure of its own', async () => {
        const abort = new AbortController()
        const running = runShellCommand({ command: 'echo started; sleep 30', cwd: tmpdir(), env, timeoutMs: 20_000, abort: abort.signal })
        abort.abort()
        expect(await running).toMatchObject({ cancelled: true, timedOut: false, error: 'Stopped' })
    })

    it('ends when the shell exits, leaving a process it put in the background to run', async () => {
        const started = Date.now()
        const result = await runShellCommand({ command: '(sleep 30 &); echo done', cwd: tmpdir(), env, timeoutMs: 20_000 })
        expect(result).toMatchObject({ exitCode: 0, output: 'done\n', error: null })
        expect(Date.now() - started).toBeLessThan(5_000)
    })

    it('keeps only the end of a long output', async () => {
        const result = await runShellCommand({ command: `yes line | head -n 40000; echo the-end`, cwd: tmpdir(), env, timeoutMs: 10_000 })
        expect(result.output.startsWith(SCRIPT_OUTPUT_CUT_MARK)).toBe(true)
        expect(result.output.length).toBe(SCRIPT_OUTPUT_CUT_MARK.length + SCRIPT_OUTPUT_MAX_CHARS)
        expect(result.output.endsWith('the-end\n')).toBe(true)
    })

    it('says what failed with the last line printed', () => {
        expect(failureText({ exitCode: 1, output: 'Fetching\nHTTPError: 503\n', timedOut: false, error: 'Exit code 1' })).toBe('exit code 1: HTTPError: 503')
        expect(failureText({ exitCode: 124, output: '', timedOut: true, error: 'Stopped after 5 min' })).toBe('Stopped after 5 min')
    })
})

describe('the folder of a script', () => {
    it('resolves under the shared folder or the coworker workspace only', () => {
        expect(scriptFolderPath('/w', 'shared/')).toBe(sharedDir())
        expect(scriptFolderPath('/w', 'shared/scripts/')).toBe(resolve(sharedDir(), 'scripts'))
        expect(scriptFolderPath('/w', 'workspace/jobs')).toBe('/w/jobs')
        expect(scriptFolderPath('/w', '')).toBe(sharedDir())
        expect(scriptFolderPath('/w', '/etc')).toBeNull()
        expect(scriptFolderPath('/w', 'shared/../../etc')).toBeNull()
        expect(isValidScriptFolder('home/me')).toBe(false)
    })
})

describe('firing a script routine', () => {
    it('runs the command with no session, keeps its output and code, and tells the hub quietly when it works', async () => {
        await mkdir(resolve(sharedDir(), 'scripts'), { recursive: true })
        await writeFile(resolve(sharedDir(), 'scripts', 'hello.sh'), 'echo "hello from $(basename "$PWD")"\n')
        const schedule = await writeSchedule(agent.id, { name: 'Hello', body: 'sh hello.sh', cron: '0 * * * *', kind: 'script', script: { runsOn: null, folder: 'shared/scripts', timeoutSec: 60, notify: 'failures' } })
        const { runId, settled } = await fireScript(agent, schedule)
        await settled

        const run = await getRun(agent.id, runId)
        expect(run).toMatchObject({ sessionId: '', status: 'done', exitCode: 0, scriptOutput: 'hello from scripts\n', triggerSource: 'schedule', triggerSlug: 'hello', error: null })
        expect((await readSchedule(agent.id, 'hello')).lastRunAt).not.toBeNull()
        expect(sent.list).toEqual([expect.objectContaining({ event: 'agent.schedule.completed', kind: 'done', sessionId: null, runId, source: 'schedule', metadata: expect.objectContaining({ scheduleSlug: 'hello', script: true, exitCode: 0, quiet: true }) })])
        expect((await listRunsByAgent(agent.id, { triggerSlug: 'hello' }))[0]).not.toHaveProperty('scriptOutput')
    })

    it('tells the hub of a failure, with the exit code and the last line', async () => {
        const schedule = await writeSchedule(agent.id, { name: 'Broken', body: 'echo boom; exit 2', cron: '0 * * * *', kind: 'script' })
        const { runId, settled } = await fireScript(agent, schedule, { markFired: false })
        await settled
        expect(await getRun(agent.id, runId)).toMatchObject({ status: 'error', exitCode: 2, error: 'exit code 2: boom' })
        expect(sent.list[0]).toMatchObject({ kind: 'error', message: 'Schedule "Broken" failed: exit code 2: boom', metadata: { exitCode: 2, timedOut: false } })
        expect((sent.list[0].metadata as Record<string, unknown>).quiet).toBeUndefined()
        expect((await readSchedule(agent.id, 'broken')).lastRunAt).toBeNull()
    })

    it('fails without running anything in a folder that does not exist', async () => {
        const schedule = await writeSchedule(agent.id, { name: 'Lost', body: 'touch made', cron: '0 * * * *', kind: 'script', script: { runsOn: null, folder: 'shared/nowhere', timeoutSec: 60, notify: 'failures' } })
        const { runId, settled } = await fireScript(agent, schedule)
        await settled
        expect(await getRun(agent.id, runId)).toMatchObject({ status: 'error', exitCode: null, scriptOutput: 'The folder shared/nowhere does not exist.' })
    })

    it('is a live run while it runs, which holds an update back but leaves its coworker free', async () => {
        const schedule = await writeSchedule(agent.id, { name: 'Slow', body: 'sleep 1', cron: '0 * * * *', kind: 'script' })
        const { settled } = await fireScript(agent, schedule, { markFired: false })
        expect(activeRunCount()).toBe(1)
        expect(agentHasLiveRun(agent.id)).toBe(false)
        await settled
        expect(activeRunCount()).toBe(0)
    })

    it('stops when its run is cancelled, and ends cancelled without a failure told', async () => {
        const schedule = await writeSchedule(agent.id, { name: 'Long', body: 'echo started; sleep 30', cron: '0 * * * *', kind: 'script' })
        const { runId, settled } = await fireScript(agent, schedule, { markFired: false })
        await abortRun(runId)
        await settled
        expect(await getRun(agent.id, runId)).toMatchObject({ status: 'cancelled', error: null })
        expect(sent.list).toEqual([expect.objectContaining({ kind: 'done', runId, message: 'Schedule "Long" stopped', metadata: expect.objectContaining({ status: 'cancelled', script: true }) })])
        expect(activeRunCount()).toBe(0)
    })

    it('says a successful run out loud when the routine asks for every run', async () => {
        const schedule = await writeSchedule(agent.id, { name: 'Loud', body: 'true', cron: '0 * * * *', kind: 'script', script: { runsOn: null, folder: 'shared/', timeoutSec: 60, notify: 'always' } })
        await (await fireScript(agent, schedule)).settled
        expect((sent.list[0].metadata as Record<string, unknown>).quiet).toBeUndefined()
    })
})
