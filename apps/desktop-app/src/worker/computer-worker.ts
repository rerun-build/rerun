import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { REMOTE_METHOD_CAPABILITY, REMOTE_METHODS, type RemoteCapability, type RemoteFacts, type RemoteMethod, type RemoteRequestFrame } from '@rerun/contracts'
import type { ActivityEntry, WorkerLink, WorkerLinkState, WorkerLocalSettings, WorkerToMain } from '../shared/remote-worker'
import { ActivityLog } from './activity'
import { RemoteFailure } from './failure'
import { readFacts } from './facts'
import { LinkConnection } from './link-connection'
import { resolveLoginEnv } from './login-env'
import { runCommand, shellFor, type ShellSpec } from './shell'

// What this build of the worker can do. A capability the person switched off in the app is left out
// of what the computer offers, and refused if the engine asks anyway.
export const WORKER_CAPABILITIES: readonly RemoteCapability[] = ['shell']

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

    constructor(private readonly options: ComputerWorkerOptions) {
        this.platform = options.platform ?? process.platform
        this.settings = options.settings
        this.env = options.env ?? resolveLoginEnv(this.platform)
        this.shell = this.env.then(env => shellFor(this.platform, env))
        this.activity = new ActivityLog(join(options.dataDir, 'activity.jsonl'))
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
        if (settings.paused) for (const controller of this.running.values()) controller.abort()
    }

    shutdown(): void {
        for (const controller of this.running.values()) controller.abort()
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
        return { appVersion: this.options.appVersion, capabilities: this.capabilities(), facts: await this.readFactsOnce(), paused: this.settings.paused }
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
        throw new RemoteFailure('unsupported', `This computer does not run ${method} yet. Update Rerun on it.`)
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
