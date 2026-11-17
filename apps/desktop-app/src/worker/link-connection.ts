import WebSocket from 'ws'
import {
    REMOTE_CLOSE,
    REMOTE_MAX_TEXT_FRAME_BYTES,
    REMOTE_MISSED_PINGS,
    REMOTE_PING_INTERVAL_MS,
    REMOTE_PROTOCOL_MAX,
    REMOTE_PROTOCOL_MIN,
    parseRemoteFrame,
    remoteEngineFrameSchema,
    type RemoteCapability,
    type RemoteEventFrame,
    type RemoteFacts,
    type RemoteRequestFrame,
} from '@rerun/contracts'
import type { WorkerLink, WorkerLinkState } from '../shared/remote-worker'
import { RemoteFailure } from './failure'

export type HelloParts = { appVersion: string; capabilities: RemoteCapability[]; facts: RemoteFacts; paused: boolean }

export type LinkDeps = {
    hello: () => Promise<HelloParts>
    handle: (request: RemoteRequestFrame, link: WorkerLink) => Promise<unknown>
    onState: (state: WorkerLinkState) => void
    onAck?: (jobId: string) => void
    onWelcome?: () => void
    fetch?: typeof fetch
    pingIntervalMs?: number
    random?: () => number
}

const MIN_DELAY_MS = 1_000
const MAX_DELAY_MS = 60_000
// A socket that stayed up this long was a good one: the next drop starts the delays over.
const STABLE_MS = 60_000
const CONNECT_TIMEOUT_MS = 15_000

type ConnectAnswer = { kind: 'socket'; socketUrl: string } | { kind: 'revoked' } | { kind: 'retry'; afterMs: number | null; error: string }

// One link of this computer to one workspace: it asks the hub where the workspace's box is, opens
// the socket, answers the engine, and comes back after any drop with a growing, jittered delay. Only
// the hub saying the link is gone (or the engine closing with `revoked`) stops it for good.
export class LinkConnection {
    private ws: WebSocket | null = null
    private stopped = false
    private attempt = 0
    private retryTimer: NodeJS.Timeout | null = null
    private pinger: NodeJS.Timeout | null = null
    private missed = 0
    private onlineSince = 0
    private state: WorkerLinkState

    constructor(
        readonly link: WorkerLink,
        private readonly deps: LinkDeps,
    ) {
        this.state = { computerId: link.computerId, status: 'connecting', since: new Date().toISOString() }
    }

    get current(): WorkerLinkState {
        return this.state
    }

    start(): void {
        void this.connect()
    }

    stop(): void {
        this.stopped = true
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.stopPings()
        this.ws?.close(1000, 'stopped')
        this.ws = null
    }

    send(frame: RemoteEventFrame): boolean {
        if (this.state.status !== 'online' || this.ws?.readyState !== WebSocket.OPEN) return false
        this.ws.send(JSON.stringify(frame))
        return true
    }

    // The person changed something on the computer: the next hello says it, so the socket starts over.
    reconnectNow(): void {
        if (this.stopped) return
        this.attempt = 0
        if (this.retryTimer) clearTimeout(this.retryTimer)
        if (this.ws) this.ws.close(1000, 'reconnect')
        else void this.connect()
    }

    private setState(status: WorkerLinkState['status'], extra: { error?: string; retryAt?: string } = {}): void {
        this.state = { computerId: this.link.computerId, status, since: new Date().toISOString(), ...extra }
        this.deps.onState(this.state)
    }

    private async askHub(): Promise<ConnectAnswer> {
        const doFetch = this.deps.fetch ?? fetch
        const { appVersion } = await this.deps.hello().catch(() => ({ appVersion: undefined }))
        let response: Response
        try {
            response = await doFetch(`${this.link.hubOrigin}/api/remote-computers/connect`, {
                method: 'POST',
                headers: { authorization: `Bearer ${this.link.token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ appVersion }),
                signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
            })
        } catch (err) {
            return { kind: 'retry', afterMs: null, error: `hub unreachable: ${(err as Error).message}` }
        }
        if (response.status === 401) return { kind: 'revoked' }
        if (!response.ok) {
            const retryAfter = Number(response.headers.get('retry-after'))
            const body = (await response.json().catch(() => ({}))) as { error?: string }
            return { kind: 'retry', afterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null, error: body.error ?? `hub answered ${response.status}` }
        }
        const body = (await response.json().catch(() => null)) as { socketUrl?: unknown } | null
        if (typeof body?.socketUrl !== 'string' || !/^wss?:\/\//.test(body.socketUrl)) return { kind: 'retry', afterMs: null, error: 'hub answered no socket' }
        return { kind: 'socket', socketUrl: body.socketUrl }
    }

    private delayFor(afterMs: number | null): number {
        const random = this.deps.random ?? Math.random
        const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** this.attempt)
        const jittered = base * (0.5 + random())
        return Math.max(afterMs ?? 0, Math.round(jittered))
    }

    private retry(error: string, afterMs: number | null = null): void {
        if (this.stopped) return
        const delay = this.delayFor(afterMs)
        this.attempt = Math.min(this.attempt + 1, 16)
        this.setState('offline', { error, retryAt: new Date(Date.now() + delay).toISOString() })
        this.retryTimer = setTimeout(() => void this.connect(), delay)
    }

    private revoked(): void {
        this.stopped = true
        this.setState('revoked')
    }

    private async connect(): Promise<void> {
        if (this.stopped) return
        this.retryTimer = null
        if (this.state.status !== 'connecting') this.setState('connecting')
        const answer = await this.askHub()
        if (this.stopped) return
        if (answer.kind === 'revoked') return this.revoked()
        if (answer.kind === 'retry') return this.retry(answer.error, answer.afterMs)
        this.open(answer.socketUrl)
    }

    private open(socketUrl: string): void {
        const ws = new WebSocket(socketUrl, { maxPayload: REMOTE_MAX_TEXT_FRAME_BYTES, handshakeTimeout: CONNECT_TIMEOUT_MS })
        this.ws = ws
        let welcomed = false
        ws.on('open', async () => {
            try {
                const hello = await this.deps.hello()
                ws.send(JSON.stringify({ type: 'hello', protocol: { min: REMOTE_PROTOCOL_MIN, max: REMOTE_PROTOCOL_MAX }, app: { version: hello.appVersion }, capabilities: hello.capabilities, facts: hello.facts, paused: hello.paused }))
            } catch {
                ws.close(1011, 'no hello')
            }
        })
        ws.on('message', (data, isBinary) => {
            this.missed = 0
            if (isBinary) return
            const frame = parseRemoteFrame(remoteEngineFrameSchema, data.toString())
            if (!frame) return
            if (frame.type === 'welcome') {
                welcomed = true
                this.onlineSince = Date.now()
                this.startPings(ws)
                this.setState('online')
                this.deps.onWelcome?.()
                return
            }
            if (frame.type === 'ack') return this.deps.onAck?.(frame.jobId)
            void this.answer(ws, frame)
        })
        ws.on('pong', () => (this.missed = 0))
        ws.on('ping', () => (this.missed = 0))
        ws.on('error', () => {})
        ws.on('unexpected-response', (_request, response) => {
            ws.terminate()
            this.ws = null
            this.retry(`socket refused: ${response.statusCode}`)
        })
        ws.on('close', (code, reason) => {
            if (this.ws !== ws) return
            this.ws = null
            this.stopPings()
            if (code === REMOTE_CLOSE.revoked) return this.revoked()
            if (welcomed && Date.now() - this.onlineSince >= STABLE_MS) this.attempt = 0
            this.retry(`socket closed: ${code}${reason.length ? ` ${reason.toString()}` : ''}`, code === REMOTE_CLOSE.protocol ? 60 * 60_000 : null)
        })
    }

    private async answer(ws: WebSocket, request: RemoteRequestFrame): Promise<void> {
        let frame: unknown
        try {
            frame = { type: 'res', id: request.id, ok: true, result: await this.deps.handle(request, this.link) }
        } catch (err) {
            const code = err instanceof RemoteFailure ? err.code : 'internal'
            frame = { type: 'res', id: request.id, ok: false, error: { code, message: ((err as Error).message || 'Failed').slice(0, 4000) } }
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
    }

    private startPings(ws: WebSocket): void {
        this.stopPings()
        this.missed = 0
        this.pinger = setInterval(() => {
            if (this.missed >= REMOTE_MISSED_PINGS) {
                ws.terminate()
                return
            }
            this.missed += 1
            ws.ping()
        }, this.deps.pingIntervalMs ?? REMOTE_PING_INTERVAL_MS)
    }

    private stopPings(): void {
        if (this.pinger) clearInterval(this.pinger)
        this.pinger = null
    }
}
