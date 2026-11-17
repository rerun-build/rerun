import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REMOTE_MAX_JOBS, type RemoteJob } from '@rerun/contracts'
import { RemoteFailure } from './failure'
import { killTree } from './process-tree'
import type { ShellSpec } from './shell'

// The long commands of this computer: each one runs in its own process group, apart from the socket,
// writes what it prints to a file of its own, and outlives a dropped connection. Its end is told to
// the engine of the link that started it, again and again, until that engine says it heard.

type JobMeta = RemoteJob & { computerId: string; pid: number | null; acked: boolean; context?: string }

// The log of a job keeps its first part on disk and its last part in memory past this size, written
// after the first once the job ends: a render that prints for hours never fills the disk.
const LOG_LIMIT_BYTES = 8 * 1024 * 1024
const LOG_KEEP_CHARS = 1024 * 1024
// Ended jobs stay listed this long, then their folder goes.
const KEEP_ENDED_MS = 7 * 24 * 60 * 60 * 1000

export type JobsDeps = {
    dir: string
    shell: () => Promise<ShellSpec>
    env: () => Promise<NodeJS.ProcessEnv>
    platform: NodeJS.Platform
    onFinished: (job: JobMeta) => void
    onCountChange: (running: number) => void
}

const isAlive = (pid: number | null): boolean => {
    if (!pid) return false
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

export class Jobs {
    private readonly running = new Map<string, { child: ChildProcess; log: WriteStream; written: number; stopping: boolean; finishing: boolean; tail: string }>()
    private readonly metas = new Map<string, JobMeta>()
    private loaded: Promise<void> | null = null

    constructor(private readonly deps: JobsDeps) {}

    private folder(id: string): string {
        return join(this.deps.dir, id)
    }

    private readonly writes = new Map<string, Promise<void>>()

    // One write at a time per job: a job that ends at once would otherwise race its own start.
    private save(meta: JobMeta): Promise<void> {
        this.metas.set(meta.id, meta)
        const path = join(this.folder(meta.id), 'meta.json')
        const next = (this.writes.get(meta.id) ?? Promise.resolve()).then(async () => {
            await writeFile(`${path}.tmp`, JSON.stringify(this.metas.get(meta.id) ?? meta, null, 2))
            await rename(`${path}.tmp`, path)
        })
        this.writes.set(meta.id, next.catch(() => {}))
        return next
    }

    // What a previous worker left: a job with no end whose process is gone, or still going without
    // anyone to read it, is lost, and what is left of it is stopped. Ended jobs past a week go.
    load(): Promise<void> {
        this.loaded ??= (async () => {
            await mkdir(this.deps.dir, { recursive: true })
            for (const id of await readdir(this.deps.dir)) {
                const meta = await readFile(join(this.folder(id), 'meta.json'), 'utf8')
                    .then(raw => JSON.parse(raw) as JobMeta)
                    .catch(() => null)
                if (!meta) continue
                if (meta.endedAt && Date.now() - Date.parse(meta.endedAt) > KEEP_ENDED_MS) {
                    await rm(this.folder(id), { recursive: true, force: true })
                    continue
                }
                if (meta.state === 'running') {
                    if (isAlive(meta.pid)) killGroup(meta.pid!, this.deps.platform)
                    await this.save({ ...meta, state: 'lost', endedAt: new Date().toISOString(), acked: false })
                    continue
                }
                this.metas.set(id, meta)
            }
        })()
        return this.loaded
    }

    count(): number {
        return this.running.size
    }

    // The ends an engine has not acknowledged yet, for a link that just came back.
    unacknowledged(computerId: string): RemoteJob[] {
        return [...this.metas.values()].filter(meta => meta.computerId === computerId && meta.state !== 'running' && !meta.acked).map(publicJob)
    }

    async acknowledge(jobId: string): Promise<void> {
        const meta = this.metas.get(jobId)
        if (meta && !meta.acked) await this.save({ ...meta, acked: true })
    }

    list(computerId: string): RemoteJob[] {
        return [...this.metas.values()].filter(meta => meta.computerId === computerId).map(publicJob).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    }

    get(computerId: string, jobId: string): JobMeta {
        const meta = this.metas.get(jobId)
        if (!meta || meta.computerId !== computerId) throw new RemoteFailure('not_found', `No job ${jobId} on this computer.`)
        return meta
    }

    async start(params: { command: string; cwd: string; label?: string; author?: string; context?: string }, computerId: string, id: string): Promise<RemoteJob> {
        await this.load()
        if (this.running.size >= REMOTE_MAX_JOBS) throw new RemoteFailure('busy', `This computer already runs ${REMOTE_MAX_JOBS} jobs: wait for one to end, or stop one.`)
        const folder = this.folder(id)
        await mkdir(folder, { recursive: true })
        const shell = await this.deps.shell()
        const log = createWriteStream(join(folder, 'output.log'), { flags: 'a' })
        const child = spawn(shell.program, shell.args(params.command), { cwd: params.cwd, env: await this.deps.env(), detached: this.deps.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const meta: JobMeta = { id, command: params.command, label: params.label, cwd: params.cwd, state: 'running', exitCode: null, startedAt: new Date().toISOString(), endedAt: null, author: params.author, computerId, pid: child.pid ?? null, acked: false, context: params.context }
        const entry = { child, log, written: 0, stopping: false, finishing: false, tail: '' }
        this.running.set(id, entry)
        const write = (chunk: Buffer) => {
            entry.written += chunk.length
            if (entry.written <= LOG_LIMIT_BYTES) log.write(chunk)
            else entry.tail = (entry.tail + chunk.toString('utf8')).slice(-LOG_KEEP_CHARS)
        }
        child.stdout?.on('data', write)
        child.stderr?.on('data', write)
        const ended = new Promise<void>(resolve => {
            child.once('error', err => {
                log.write(`\n[could not start: ${err.message}]\n`)
                void this.finish(id, 'failed', null).then(resolve)
            })
            child.once('close', (code, signal) => {
                const state = entry.stopping ? 'stopped' : code === 0 ? 'succeeded' : 'failed'
                void this.finish(id, state, signal ? null : code).then(resolve)
            })
        })
        void ended
        await this.save(meta)
        this.deps.onCountChange(this.running.size)
        return publicJob(meta)
    }

    private async finish(id: string, state: RemoteJob['state'], exitCode: number | null): Promise<void> {
        const entry = this.running.get(id)
        if (!entry || entry.finishing) return
        entry.finishing = true
        if (entry.tail) entry.log.write(`\n[… output dropped …]\n${entry.tail}`)
        await new Promise<void>(resolve => entry.log.end(resolve))
        const meta = this.metas.get(id)!
        const done: JobMeta = { ...meta, state, exitCode, endedAt: new Date().toISOString(), acked: false }
        await this.save(done)
        this.running.delete(id)
        this.deps.onCountChange(this.running.size)
        this.deps.onFinished(done)
    }

    async logs(computerId: string, jobId: string, tailBytes: number): Promise<{ job: RemoteJob; output: string; truncated: boolean }> {
        const meta = this.get(computerId, jobId)
        const live = this.running.get(jobId)
        if (live?.tail) return { job: publicJob(meta), output: live.tail.slice(-tailBytes), truncated: true }
        const path = join(this.folder(jobId), 'output.log')
        const size = await stat(path).then(info => info.size).catch(() => 0)
        return { job: publicJob(meta), output: await readTail(path, tailBytes), truncated: size > tailBytes }
    }

    async stop(computerId: string, jobId: string): Promise<RemoteJob> {
        const meta = this.get(computerId, jobId)
        const entry = this.running.get(jobId)
        if (!entry) return publicJob(meta)
        entry.stopping = true
        killTree(entry.child, this.deps.platform)
        await new Promise<void>(resolve => {
            const check = setInterval(() => {
                if (!this.running.has(jobId)) {
                    clearInterval(check)
                    resolve()
                }
            }, 50)
        })
        return publicJob(this.metas.get(jobId)!)
    }

    // Quitting the app stops every job, and says so to the engines when they come back.
    async stopAll(): Promise<void> {
        for (const entry of this.running.values()) {
            entry.stopping = true
            killTree(entry.child, this.deps.platform)
        }
    }
}

function publicJob(meta: JobMeta): RemoteJob {
    return { id: meta.id, command: meta.command, label: meta.label, cwd: meta.cwd, state: meta.state, exitCode: meta.exitCode, startedAt: meta.startedAt, endedAt: meta.endedAt, author: meta.author, context: meta.context }
}

function killGroup(pid: number, platform: NodeJS.Platform): void {
    if (platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
        return
    }
    try {
        process.kill(-pid, 'SIGKILL')
    } catch {
        try {
            process.kill(pid, 'SIGKILL')
        } catch {
            // Already gone.
        }
    }
}

async function readTail(path: string, bytes: number): Promise<string> {
    const handle = await open(path, 'r').catch(() => null)
    if (!handle) return ''
    try {
        const { size } = await handle.stat()
        const length = Math.min(bytes, size)
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, size - length)
        return buffer.toString('utf8')
    } finally {
        await handle.close()
    }
}
