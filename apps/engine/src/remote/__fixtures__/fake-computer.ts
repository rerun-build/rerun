import { WebSocket } from 'ws'
import { REMOTE_PROTOCOL_MAX, REMOTE_PROTOCOL_MIN, type RemoteCapability, type RemoteErrorCode, type RemoteFacts, type RemoteJob, type RemoteMethod } from '@rerun/contracts'

// A computer that speaks the real protocol over a real socket, for the tests of the engine: it
// answers each method with the handler given, or `unsupported`, and records what the engine sent.

export class FakeRemoteError extends Error {
    constructor(
        readonly code: RemoteErrorCode,
        message: string,
    ) {
        super(message)
    }
}

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>

export type FakeComputerOptions = {
    capabilities?: RemoteCapability[]
    facts?: Partial<RemoteFacts>
    paused?: boolean
    protocol?: { min: number; max: number }
    appVersion?: string
    handlers?: Partial<Record<RemoteMethod, Handler>>
    // Sends this instead of a hello, to test what the engine does with a bad one.
    rawHello?: string
    skipHello?: boolean
    // Off: the computer stops answering the engine's pings, like a laptop gone to sleep.
    autoPong?: boolean
}

export const FAKE_FACTS: RemoteFacts = {
    hostname: 'studio',
    os: 'mac',
    osVersion: '15.1',
    arch: 'arm64',
    shell: 'zsh',
    homeDir: '/Users/claire',
    workDir: '/Users/claire/Rerun',
    software: ['ffmpeg', 'python3'],
}

export type FakeComputer = {
    ws: WebSocket
    welcome: Promise<{ protocol: number; computerId: string }>
    requests: { method: string; params: Record<string, unknown> }[]
    acks: string[]
    closed: Promise<{ code: number; reason: string }>
    send: (frame: unknown) => void
    jobFinished: (job: RemoteJob) => void
    status: (paused: boolean, capabilities?: RemoteCapability[]) => void
    close: () => Promise<void>
}

export function connectFakeComputer(url: string, options: FakeComputerOptions = {}): Promise<FakeComputer> {
    const ws = new WebSocket(url, { autoPong: options.autoPong ?? true })
    const requests: FakeComputer['requests'] = []
    const acks: string[] = []
    const send = (frame: unknown) => ws.send(JSON.stringify(frame))
    let welcomed!: (value: { protocol: number; computerId: string }) => void
    const welcome = new Promise<{ protocol: number; computerId: string }>(resolve => (welcomed = resolve))
    const closed = new Promise<{ code: number; reason: string }>(resolve => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))

    ws.on('message', async data => {
        const frame = JSON.parse(data.toString()) as { type: string; id?: string; method?: string; params?: Record<string, unknown>; protocol?: number; computerId?: string; jobId?: string }
        if (frame.type === 'welcome') return welcomed({ protocol: frame.protocol!, computerId: frame.computerId! })
        if (frame.type === 'ack') return void acks.push(frame.jobId!)
        if (frame.type !== 'req') return
        requests.push({ method: frame.method!, params: frame.params ?? {} })
        const handler = options.handlers?.[frame.method as RemoteMethod]
        if (!handler) return send({ type: 'res', id: frame.id, ok: false, error: { code: 'unsupported', message: `no ${frame.method}` } })
        try {
            send({ type: 'res', id: frame.id, ok: true, result: await handler(frame.params ?? {}) })
        } catch (err) {
            const code = err instanceof FakeRemoteError ? err.code : 'internal'
            send({ type: 'res', id: frame.id, ok: false, error: { code, message: (err as Error).message } })
        }
    })

    return new Promise((resolve, reject) => {
        ws.once('unexpected-response', (_request, response) => reject(new Error(`refused: ${response.statusCode}`)))
        ws.once('error', reject)
        ws.once('open', () => {
            if (options.skipHello) {
                // Nothing: the test sends what it wants.
            } else if (options.rawHello !== undefined) ws.send(options.rawHello)
            else
                send({
                    type: 'hello',
                    protocol: options.protocol ?? { min: REMOTE_PROTOCOL_MIN, max: REMOTE_PROTOCOL_MAX },
                    app: { version: options.appVersion ?? '0.2.0' },
                    capabilities: options.capabilities ?? ['shell', 'files', 'jobs'],
                    facts: { ...FAKE_FACTS, ...options.facts },
                    paused: options.paused ?? false,
                })
            resolve({
                ws,
                welcome,
                requests,
                acks,
                closed,
                send,
                jobFinished: job => send({ type: 'event', event: 'job.finished', job }),
                status: (paused, capabilities) => send({ type: 'event', event: 'status', paused, ...(capabilities ? { capabilities } : {}) }),
                close: async () => {
                    if (ws.readyState === WebSocket.CLOSED) return
                    ws.close()
                    await closed
                },
            })
        })
    })
}
