import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteJob } from '@rerun/contracts'
import { Jobs } from '../src/worker/jobs'
import { shellFor } from '../src/worker/shell'

const posix = process.platform !== 'win32'

function jobsIn(dir = mkdtempSync(join(tmpdir(), 'rerun-jobs-'))) {
    const finished: RemoteJob[] = []
    const counts: number[] = []
    const jobs = new Jobs({
        dir,
        shell: async () => shellFor(process.platform, { SHELL: '/bin/sh' }),
        env: async () => process.env,
        platform: process.platform,
        onFinished: job => finished.push(job),
        onCountChange: running => counts.push(running),
    })
    return { jobs, finished, counts, dir }
}

const alive = (pid: number) => {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

describe.runIf(posix)('the jobs of a linked computer', () => {
    it('runs a job apart, keeps what it prints, and says when it ends, with what the engine gave it', async () => {
        const { jobs, finished, counts } = jobsIn()
        const job = await jobs.start({ command: 'echo "rendu été"; sleep 0.2; echo done', cwd: tmpdir(), label: 'Teaser', author: 'Claire', context: '{"a":"x","s":"y"}' }, 'c1', 'job1')
        expect(job).toMatchObject({ id: 'job1', state: 'running', label: 'Teaser', author: 'Claire', context: '{"a":"x","s":"y"}' })
        expect(jobs.count()).toBe(1)
        await vi.waitFor(() => expect(finished).toHaveLength(1), { timeout: 10_000 })
        expect(finished[0]).toMatchObject({ id: 'job1', state: 'succeeded', exitCode: 0, endedAt: expect.any(String) })
        expect(counts).toEqual([1, 0])
        expect((await jobs.logs('c1', 'job1', 1000)).output).toBe('rendu été\ndone\n')
        expect(jobs.list('c1').map(item => item.id)).toEqual(['job1'])
        expect(jobs.list('c2')).toEqual([])
        expect(() => jobs.get('c2', 'job1')).toThrow(/No job/)
    })

    it('reports a failure with its exit code', async () => {
        const { jobs, finished } = jobsIn()
        await jobs.start({ command: 'echo oops >&2; exit 7', cwd: tmpdir() }, 'c1', 'bad')
        await vi.waitFor(() => expect(finished[0]).toMatchObject({ state: 'failed', exitCode: 7 }), { timeout: 10_000 })
        expect((await jobs.logs('c1', 'bad', 100)).output).toBe('oops\n')
    })

    it('stops a job with everything it started', async () => {
        const { jobs, finished, dir } = jobsIn()
        const pidFile = join(dir, 'child.pid')
        await jobs.start({ command: `sh -c 'sleep 60 & echo $! > ${pidFile}; wait'`, cwd: tmpdir() }, 'c1', 'long')
        await vi.waitFor(() => expect(readFileSync(pidFile, 'utf8').trim()).not.toBe(''), { timeout: 10_000 })
        const grandchild = Number(readFileSync(pidFile, 'utf8'))
        const stopped = await jobs.stop('c1', 'long')
        expect(stopped.state).toBe('stopped')
        expect(finished[0]).toMatchObject({ id: 'long', state: 'stopped' })
        await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 10_000 })
    })

    it('runs four jobs at most at once', async () => {
        const { jobs } = jobsIn()
        for (let i = 0; i < 4; i++) await jobs.start({ command: 'sleep 30', cwd: tmpdir() }, 'c1', `j${i}`)
        await expect(jobs.start({ command: 'sleep 30', cwd: tmpdir() }, 'c1', 'j5')).rejects.toMatchObject({ code: 'busy' })
        await jobs.stopAll()
        await vi.waitFor(() => expect(jobs.count()).toBe(0), { timeout: 10_000 })
    })

    it('keeps telling the end until the engine says it heard, and remembers that across a restart', async () => {
        const { jobs, finished, dir } = jobsIn()
        await jobs.start({ command: 'true', cwd: tmpdir() }, 'c1', 'quick')
        await vi.waitFor(() => expect(finished).toHaveLength(1), { timeout: 10_000 })
        expect(jobs.unacknowledged('c1').map(job => job.id)).toEqual(['quick'])
        const again = jobsIn(dir)
        await again.jobs.load()
        expect(again.jobs.unacknowledged('c1').map(job => job.id)).toEqual(['quick'])
        await again.jobs.acknowledge('quick')
        expect(again.jobs.unacknowledged('c1')).toEqual([])
        const third = jobsIn(dir)
        await third.jobs.load()
        expect(third.jobs.unacknowledged('c1')).toEqual([])
    })

    it('marks lost a job the previous worker left running, and stops what is left of it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rerun-jobs-'))
        const { spawn } = await import('node:child_process')
        const orphan = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
        mkdirSync(join(dir, 'ghost'))
        writeFileSync(join(dir, 'ghost', 'meta.json'), JSON.stringify({ id: 'ghost', command: 'sleep 60', cwd: '/', state: 'running', exitCode: null, startedAt: new Date().toISOString(), endedAt: null, computerId: 'c1', pid: orphan.pid, acked: false }))
        const { jobs } = jobsIn(dir)
        await jobs.load()
        expect(jobs.unacknowledged('c1')).toEqual([expect.objectContaining({ id: 'ghost', state: 'lost' })])
        await vi.waitFor(() => expect(alive(orphan.pid!)).toBe(false), { timeout: 10_000 })
    })

    it('leaves alone a process that only took the pid of a job long gone', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rerun-jobs-'))
        const { spawn } = await import('node:child_process')
        const bystander = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
        mkdirSync(join(dir, 'old'))
        writeFileSync(join(dir, 'old', 'meta.json'), JSON.stringify({ id: 'old', command: 'sleep 60', cwd: '/', state: 'running', exitCode: null, startedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), endedAt: null, computerId: 'c1', pid: bystander.pid, acked: false }))
        const { jobs } = jobsIn(dir)
        await jobs.load()
        expect(jobs.unacknowledged('c1')).toEqual([expect.objectContaining({ id: 'old', state: 'lost' })])
        expect(alive(bystander.pid!)).toBe(true)
        process.kill(-bystander.pid!, 'SIGKILL')
    })

    it('drops the middle of a log that grows past its limit, keeping the end', async () => {
        const { jobs, finished } = jobsIn()
        await jobs.start({ command: 'head -c 12000000 /dev/zero | tr "\\0" "x"; echo; echo THE-END', cwd: tmpdir() }, 'c1', 'chatty')
        await vi.waitFor(() => expect(finished).toHaveLength(1), { timeout: 30_000 })
        const logs = await jobs.logs('c1', 'chatty', 50)
        expect(logs.output.trim().endsWith('THE-END')).toBe(true)
        expect(logs.truncated).toBe(true)
    })
})
