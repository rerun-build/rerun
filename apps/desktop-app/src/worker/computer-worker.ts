import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { REMOTE_METHOD_CAPABILITY, REMOTE_METHODS, type RemoteCapability, type RemoteFacts, type RemoteMethod, type RemoteRequestFrame } from '@rerun/contracts'
import type { ActivityEntry, WorkerLink, WorkerLinkState, WorkerLocalSettings, WorkerToMain } from '../shared/remote-worker'
import { ActivityLog } from './activity'
import { RemoteFailure } from './failure'
import { osOf, readFacts } from './facts'
import { ComputerFiles, type FileScope } from './files'
import { Jobs } from './jobs'
import { randomBytes } from 'node:crypto'
import { LinkConnection } from './link-connection'
import { resolveLoginEnv } from './login-env'
import { runCommand, shellFor, type ShellSpec } from './shell'

// What this build of the worker can do. A capability the person switched off in the app is left out
// of what the computer offers, and refused if the engine asks anyway.
export const WORKER_CAPABILITIES: readonly RemoteCapability[] = ['shell', 'files', 'jobs']

export type ComputerWorkerOptions = {
    dataDir: string
    appVersion: string
    settings: WorkerLocalSettings
    send: (message: WorkerToMain) => void
    platform?: NodeJS.Platform
    env?: Promise<NodeJS.ProcessEnv>
    fetch?: typeof fetch
    pingIntervalMs?: number
}

const summarize = (command: string) => (command.length > 300 ? `${command.slice(0, 300)}…` : command)

export class ComputerWorker {
    private readonly links = new Map<string, LinkConnection>()
    private readonly running = new Map<string, AbortController>()
    private readonly activity: ActivityLog
    private readonly platform: NodeJS.Platform
    private readonly env: Promise<NodeJS.ProcessEnv>
    private readonly shell: Promise<ShellSpec>
    private settings: WorkerLocalSettings
    private facts: Promise<RemoteFacts> | null = null
    private readonly files: ComputerFiles
    private readonly jobs: Jobs
    private readonly resendTimers = new Map<string, NodeJS.Timeout>()

    constructor(private readonly options: ComputerWorkerOptions) {
        this.platform = options.platform ?? process.platform
        this.settings = options.settings
        this.env = options.env ?? resolveLoginEnv(this.platform)
        this.shell = this.env.then(env => shellFor(this.platform, env))
        this.activity = new ActivityLog(join(options.dataDir, 'activity.jsonl'))
        this.files = new ComputerFiles(osOf(this.platform), () => this.settings.workDir)
        this.jobs = new Jobs({
            dir: join(options.dataDir, 'jobs'),
            shell: () => this.shell,
            env: () => this.env,
            platform: this.platform,
            onFinished: job => this.tellJobFinished(job.computerId, job.id),
            onCountChange: running => this.jobCountChanged(running),
        })
        void this.jobs.load().then(() => this.jobCountChanged(this.jobs.count()))
    }

    private jobCountChanged(running: number): void {
        this.options.send({ type: 'busy', runningJobs: running })
        for (const connection of this.links.values()) connection.send({ type: 'event', event: 'status', paused: this.settings.paused, capabilities: this.capabilities(), runningJobs: running })
    }

    // The end of a job goes to the engine of the link that started it, and again until it says it
    // heard: when the link comes back, and every half minute while it stays quiet.
    private tellJobFinished(computerId: string, jobId: string): void {
        const connection = this.links.get(computerId)
        const job = this.jobs.unacknowledged(computerId).find(item => item.id === jobId)
        if (!connection || !job) return
        connection.send({ type: 'event', event: 'job.finished', job })
        clearTimeout(this.resendTimers.get(jobId))
        const timer = setTimeout(() => this.tellJobFinished(computerId, jobId), 30_000)
        timer.unref()
        this.resendTimers.set(jobId, timer)
    }

    private resendJobs(computerId: string): void {
        void this.jobs.load().then(() => {
            for (const job of this.jobs.unacknowledged(computerId)) this.tellJobFinished(computerId, job.id)
        })
    }

    private acknowledged(jobId: string): void {
        clearTimeout(this.resendTimers.get(jobId))
        this.resendTimers.delete(jobId)
        void this.jobs.acknowledge(jobId)
    }

    capabilities(): RemoteCapability[] {
        return WORKER_CAPABILITIES.filter(capability => this.settings.capabilities.includes(capability))
    }

    setLinks(links: WorkerLink[]): void {
        const wanted = new Map(links.map(link => [link.computerId, link]))
        for (const [id, connection] of this.links) {
            const next = wanted.get(id)
            if (next && next.token === connection.link.token && next.hubOrigin === connection.link.hubOrigin) continue
            connection.stop()
            this.links.delete(id)
        }
        for (const link of links) {
            if (this.links.has(link.computerId)) continue
            const connection = new LinkConnection(link, {
                hello: () => this.hello(),
                handle: (request, from) => this.handle(request, from),
                onState: state => this.linkChanged(state),
                onWelcome: () => this.resendJobs(link.computerId),
                onAck: jobId => this.acknowledged(jobId),
                fetch: this.options.fetch,
                pingIntervalMs: this.options.pingIntervalMs,
            })
            this.links.set(link.computerId, connection)
            connection.start()
        }
        this.publishState()
    }

    setSettings(settings: WorkerLocalSettings): void {
        const before = this.settings
        this.settings = settings
        if (before.workDir !== settings.workDir) {
            this.facts = null
            for (const connection of this.links.values()) connection.reconnectNow()
            return
        }
        if (before.paused === settings.paused && before.capabilities.join() === settings.capabilities.join()) return
        for (const connection of this.links.values()) connection.send({ type: 'event', event: 'status', paused: settings.paused, capabilities: this.capabilities() })
        if (settings.paused) {
            for (const controller of this.running.values()) controller.abort()
            void this.jobs.stopAll()
        }
    }

    shutdown(): void {
        for (const controller of this.running.values()) controller.abort()
        void this.jobs.stopAll()
        for (const timer of this.resendTimers.values()) clearTimeout(timer)
        for (const connection of this.links.values()) connection.stop()
        this.links.clear()
    }

    states(): WorkerLinkState[] {
        return [...this.links.values()].map(connection => connection.current)
    }

    private linkChanged(state: WorkerLinkState): void {
        if (state.status === 'revoked') this.options.send({ type: 'revoked', computerId: state.computerId })
        this.publishState()
    }

    private publishState(): void {
        this.options.send({ type: 'state', links: this.states() })
    }

    private async readFactsOnce(): Promise<RemoteFacts> {
        this.facts ??= (async () => {
            const env = await this.env
            return readFacts({ env, workDir: this.settings.workDir, shell: (await this.shell).name, platform: this.platform })
        })()
        return this.facts
    }

    private async hello() {
        return { appVersion: this.options.appVersion, capabilities: this.capabilities(), facts: await this.readFactsOnce(), paused: this.settings.paused, runningJobs: this.jobs.count() }
    }

    private record(entry: Omit<ActivityEntry, 'at'>): void {
        const full = { ...entry, at: new Date().toISOString() }
        void this.activity.record(full)
        this.options.send({ type: 'activity', entry: full })
    }

    // A folder the command starts in: the working folder, a path under it, or an absolute one. It must exist.
    private async resolveCwd(cwd: string | undefined): Promise<string> {
        await mkdir(this.settings.workDir, { recursive: true })
        if (!cwd) return this.settings.workDir
        const expanded = cwd === '~' || cwd.startsWith('~/') || cwd.startsWith('~\\') ? join(homedir(), cwd.slice(1)) : cwd
        const target = isAbsolute(expanded) ? expanded : resolve(this.settings.workDir, expanded)
        const info = await stat(target).catch(() => null)
        if (!info?.isDirectory()) throw new RemoteFailure('not_found', `No folder at ${target} on this computer.`)
        return target
    }

    async handle(request: RemoteRequestFrame, link: WorkerLink): Promise<unknown> {
        if (!Object.hasOwn(REMOTE_METHODS, request.method)) throw new RemoteFailure('unsupported', `This computer does not know ${request.method}. Update Rerun on it.`)
        const method = request.method as RemoteMethod
        const capability = REMOTE_METHOD_CAPABILITY[method]
        if (capability && !this.capabilities().includes(capability)) throw new RemoteFailure('capability_off', `The person switched ${capability} off on this computer.`)
        if (this.settings.paused && method !== 'info') throw new RemoteFailure('paused', 'The person paused Rerun on this computer.')
        const parsed = REMOTE_METHODS[method].params.safeParse(request.params)
        if (!parsed.success) throw new RemoteFailure('invalid', `Invalid ${method} request.`)
        const params = parsed.data as Record<string, unknown>

        if (method === 'info') return { facts: await this.readFactsOnce(), paused: this.settings.paused }
        if (method === 'exec.cancel') {
            const controller = this.running.get(params.execId as string)
            controller?.abort()
            return { cancelled: !!controller }
        }
        if (method === 'exec.run') return this.exec(params as { execId: string; command: string; cwd?: string; timeoutMs: number; author?: string }, link)
        if (method.startsWith('fs.')) return this.file(method, params, link)
        if (method.startsWith('job.')) return this.job(method, params, link)
        throw new RemoteFailure('unsupported', `This computer does not run ${method} yet. Update Rerun on it.`)
    }

    private async file(method: RemoteMethod, params: Record<string, unknown>, link: WorkerLink): Promise<unknown> {
        const scope: FileScope = { roots: (params.roots as string[] | null) ?? null, sensitiveOk: params.sensitiveOk === true }
        const path = params.path as string
        const record = (summary: string, outcome: ActivityEntry['outcome']) => this.record({ computerId: link.computerId, author: (params.author as string | undefined) ?? null, kind: 'file', summary, outcome })
        try {
            if (method === 'fs.list') return await this.files.list(path, scope)
            if (method === 'fs.stat') return await this.files.stat(path, scope)
            if (method === 'fs.read') {
                const result = await this.files.read(path, params.maxBytes as number, scope)
                record(`Read ${result.path}`, 'ok')
                return result
            }
            if (method === 'fs.write') {
                const result = await this.files.write(path, params.content as string, params.encoding as 'utf8' | 'base64', scope)
                record(`Wrote ${result.path}`, 'ok')
                return result
            }
            if (method === 'fs.pull') {
                const result = await this.files.pull(path, params.offset as number, scope)
                if (result.eof) record(`Copied ${result.path} to the workspace`, 'ok')
                return result
            }
            const result = await this.files.push(params as Parameters<ComputerFiles['push']>[0], scope)
            if (result.done) record(`Received ${result.path}`, 'ok')
            return result
        } catch (err) {
            if (err instanceof RemoteFailure && (err.code === 'sensitive_path' || err.code === 'outside_workdir')) record(`${method} ${path}`, 'refused')
            throw err
        }
    }

    private async job(method: RemoteMethod, params: Record<string, unknown>, link: WorkerLink): Promise<unknown> {
        await this.jobs.load()
        if (method === 'job.list') return { jobs: this.jobs.list(link.computerId) }
        if (method === 'job.status') return { job: this.jobs.list(link.computerId).find(job => job.id === params.jobId) ?? this.jobs.get(link.computerId, params.jobId as string) }
        if (method === 'job.logs') return this.jobs.logs(link.computerId, params.jobId as string, params.tailBytes as number)
        if (method === 'job.stop') {
            const job = await this.jobs.stop(link.computerId, params.jobId as string)
            this.record({ computerId: link.computerId, author: null, kind: 'job', summary: `Stopped ${summarize(job.command)}`, outcome: 'ok' })
            return { job }
        }
        const command = params.command as string
        const base = { computerId: link.computerId, author: (params.author as string | undefined) ?? null, kind: 'job' as const, summary: summarize(command) }
        try {
            const cwd = await this.resolveCwd(params.cwd as string | undefined)
            const job = await this.jobs.start({ command, cwd, label: params.label as string | undefined, author: params.author as string | undefined, context: params.context as string | undefined }, link.computerId, randomBytes(8).toString('hex'))
            this.record({ ...base, outcome: 'ok' })
            return { job }
        } catch (err) {
            this.record({ ...base, outcome: 'failed' })
            throw err
        }
    }

    private async exec(params: { execId: string; command: string; cwd?: string; timeoutMs: number; author?: string }, link: WorkerLink) {
        const base = { computerId: link.computerId, author: params.author ?? null, kind: 'command' as const, summary: summarize(params.command) }
        const cwd = await this.resolveCwd(params.cwd).catch(err => {
            this.record({ ...base, outcome: 'failed' })
            throw err
        })
        const controller = new AbortController()
        this.running.set(params.execId, controller)
        try {
            const result = await runCommand({ command: params.command, cwd, env: await this.env, shell: await this.shell, timeoutMs: params.timeoutMs, signal: controller.signal, platform: this.platform })
            this.record({ ...base, outcome: result.exitCode === 0 ? 'ok' : 'failed' })
            if (controller.signal.aborted) throw new RemoteFailure(this.settings.paused ? 'paused' : 'cancelled', this.settings.paused ? 'The person paused Rerun on this computer: the command was stopped.' : 'The command was stopped.')
            return result
        } catch (err) {
            if (err instanceof RemoteFailure) throw err
            this.record({ ...base, outcome: 'failed' })
            throw new RemoteFailure('internal', `The command could not start: ${(err as Error).message}`)
        } finally {
            this.running.delete(params.execId)
        }
    }
}
