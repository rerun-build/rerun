import type { WebSocket } from 'ws'
import {
    REMOTE_CLOSE,
    REMOTE_METHOD_CAPABILITY,
    REMOTE_METHODS,
    REMOTE_MISSED_PINGS,
    REMOTE_PING_INTERVAL_MS,
    parseRemoteFrame,
    remoteEventFrameSchema,
    remoteResponseFrameSchema,
    type RemoteCapability,
    type RemoteErrorCode,
    type RemoteEventFrame,
    type RemoteFacts,
    type RemoteMethod,
    type RemoteParams,
    type RemoteResult,
} from '@rerun/contracts'
import { z } from 'zod'
import { newId } from '../lib/ids.js'

export class RemoteCallError extends Error {
    constructor(
        readonly code: RemoteErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'RemoteCallError'
    }
}

const frameSchema = z.union([remoteResponseFrameSchema, remoteEventFrameSchema])

type Pending = { method: RemoteMethod; resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout; cleanup: () => void }

export type RemoteConnectionInfo = {
    computerId: string
    protocol: number
    appVersion: string
    capabilities: RemoteCapability[]
    facts: RemoteFacts
    paused: boolean
}

export type CallOptions = { timeoutMs?: number; signal?: AbortSignal }

const DEFAULT_TIMEOUT_MS = 30_000
// One computer's socket, once its hello was accepted. The engine asks, the computer answers; the
// computer also tells on its own (a job finished, the person paused it). Both ends ping: a computer
// that misses `REMOTE_MISSED_PINGS` in a row is hung up on, which is how a laptop that went to sleep
// behind a NAT leaves the list instead of looking online for hours.
export class RemoteConnection {
    readonly computerId: string
    readonly protocol: number
    readonly appVersion: string
    readonly connectedAt: Date
    capabilities: Set<RemoteCapability>
    facts: RemoteFacts
    paused: boolean
    lastSeenAt: Date
    private readonly pending = new Map<string, Pending>()
    private readonly eventListeners = new Set<(event: RemoteEventFrame) => void>()
    private readonly closeListeners = new Set<() => void>()
    private readonly pinger: NodeJS.Timeout
    private missedPings = 0
    private closed = false

    constructor(
        private readonly ws: WebSocket,
        info: RemoteConnectionInfo,
        options: { pingIntervalMs?: number } = {},
    ) {
        this.computerId = info.computerId
        this.protocol = info.protocol
        this.appVersion = info.appVersion
        this.capabilities = new Set(info.capabilities)
        this.facts = info.facts
        this.paused = info.paused
        this.connectedAt = new Date()
        this.lastSeenAt = new Date()
        ws.on('message', (data, isBinary) => {
            this.seen()
            if (!isBinary) this.receive(data.toString())
        })
        ws.on('pong', () => this.seen())
        ws.on('ping', () => this.seen())
        ws.once('close', () => this.settleClosed())
        ws.once('error', () => this.settleClosed())
        this.pinger = setInterval(() => this.ping(), options.pingIntervalMs ?? REMOTE_PING_INTERVAL_MS)
        this.pinger.unref()
    }

    get open(): boolean {
        return !this.closed
    }

    get pendingCount(): number {
        return this.pending.size
    }

    offers(capability: RemoteCapability): boolean {
        return this.capabilities.has(capability)
    }

    call<M extends RemoteMethod>(method: M, params: RemoteParams<M>, { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: CallOptions = {}): Promise<RemoteResult<M>> {
        if (this.closed) return Promise.reject(new RemoteCallError('disconnected', 'The computer went offline.'))
        const capability = REMOTE_METHOD_CAPABILITY[method]
        if (capability && !this.offers(capability)) return Promise.reject(new RemoteCallError('capability_off', `This computer does not offer ${capability}.`))
        if (signal?.aborted) return Promise.reject(new RemoteCallError('cancelled', 'Cancelled.'))
        const parsedParams = REMOTE_METHODS[method].params.safeParse(params)
        if (!parsedParams.success) return Promise.reject(new RemoteCallError('invalid', `Invalid ${method} request: ${parsedParams.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`))
        const id = newId()
        return new Promise<RemoteResult<M>>((resolve, reject) => {
            const onAbort = () => this.settle(id, new RemoteCallError('cancelled', 'Cancelled.'))
            const timer = setTimeout(() => this.settle(id, new RemoteCallError('timeout', `The computer did not answer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs)
            signal?.addEventListener('abort', onAbort, { once: true })
            this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer, cleanup: () => signal?.removeEventListener('abort', onAbort) })
            this.ws.send(JSON.stringify({ type: 'req', id, method, params: parsedParams.data }), err => {
                if (err) this.settle(id, new RemoteCallError('disconnected', 'The computer went offline.'))
            })
        })
    }

    acknowledgeJob(jobId: string): void {
        if (!this.closed) this.ws.send(JSON.stringify({ type: 'ack', event: 'job.finished', jobId }))
    }

    onEvent(listener: (event: RemoteEventFrame) => void): () => void {
        this.eventListeners.add(listener)
        return () => this.eventListeners.delete(listener)
    }

    onClose(listener: () => void): void {
        if (this.closed) listener()
        else this.closeListeners.add(listener)
    }

    close(code: number, reason: string): void {
        if (this.closed) return
        this.ws.close(code, reason)
        this.settleClosed()
    }

    private seen(): void {
        this.missedPings = 0
        this.lastSeenAt = new Date()
    }

    private ping(): void {
        if (this.closed) return
        if (this.missedPings >= REMOTE_MISSED_PINGS) {
            this.ws.close(REMOTE_CLOSE.unresponsive, 'unresponsive')
            this.ws.terminate()
            this.settleClosed()
            return
        }
        this.missedPings += 1
        this.ws.ping()
    }

    private receive(raw: string): void {
        const frame = parseRemoteFrame(frameSchema, raw)
        if (!frame) return
        if (frame.type === 'event') {
            if (frame.event === 'status') {
                this.paused = frame.paused
                if (frame.capabilities) this.capabilities = new Set(frame.capabilities)
            }
            for (const listener of this.eventListeners) listener(frame)
            return
        }
        const entry = this.pending.get(frame.id)
        if (!entry) return
        if (!frame.ok) return this.settle(frame.id, new RemoteCallError(frame.error.code, frame.error.message))
        const result = REMOTE_METHODS[entry.method].result.safeParse(frame.result)
        if (!result.success) return this.settle(frame.id, new RemoteCallError('invalid', `The computer answered ${entry.method} in a shape this engine does not read.`))
        this.settle(frame.id, null, result.data)
    }

    private settle(id: string, error: Error | null, value?: unknown): void {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        clearTimeout(entry.timer)
        entry.cleanup()
        if (error) entry.reject(error)
        else entry.resolve(value)
    }

    private settleClosed(): void {
        if (this.closed) return
        this.closed = true
        clearInterval(this.pinger)
        for (const id of [...this.pending.keys()]) this.settle(id, new RemoteCallError('disconnected', 'The computer went offline.'))
        for (const listener of this.closeListeners) listener()
        this.closeListeners.clear()
        this.eventListeners.clear()
    }
}
