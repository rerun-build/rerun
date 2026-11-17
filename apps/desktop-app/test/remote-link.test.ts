import { mkdtempSync, realpathSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { REMOTE_CLOSE } from '@rerun/contracts'
import type { WorkerLinkState, WorkerToMain } from '../src/shared/remote-worker'
import { ComputerWorker } from '../src/worker/computer-worker'

// A hub that answers the connect route as told, and an engine that welcomes the computer and records
// what it says, both on real sockets.

type HubAnswer = { status: number; body?: unknown; retryAfter?: string }

let hub: Server
let engine: WebSocketServer
let hubAnswer: () => HubAnswer
let hubCalls: { authorization: string | undefined; body: unknown }[]
let sockets: WebSocket[]
let hellos: Record<string, unknown>[]
let frames: Record<string, unknown>[]
let enginePort: number
let hubOrigin: string
let messages: WorkerToMain[]
let workers: ComputerWorker[]
const dataDir = mkdtempSync(join(tmpdir(), 'rerun-worker-'))
const workDir = join(dataDir, 'Rerun')

beforeEach(async () => {
    hubCalls = []
    sockets = []
    hellos = []
    frames = []
    messages = []
    workers = []
    engine = new WebSocketServer({ port: 0 })
    engine.on('connection', ws => {
        sockets.push(ws)
        ws.once('message', data => {
            const hello = JSON.parse(data.toString())
            hellos.push(hello)
            ws.send(JSON.stringify({ type: 'welcome', protocol: 1, computerId: 'c1' }))
            ws.on('message', more => frames.push(JSON.parse(more.toString())))
        })
    })
    await new Promise(done => engine.once('listening', done))
    enginePort = (engine.address() as AddressInfo).port
    hubAnswer = () => ({ status: 200, body: { socketUrl: `ws://127.0.0.1:${enginePort}/remote/ws?ticket=t`, computer: { id: 'c1', handle: 'pc', name: 'PC' } } })
    hub = createServer((req, res) => {
        let raw = ''
        req.on('data', chunk => (raw += chunk))
        req.on('end', () => {
            hubCalls.push({ authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : null })
            const answer = hubAnswer()
            res.writeHead(answer.status, { 'content-type': 'application/json', ...(answer.retryAfter ? { 'retry-after': answer.retryAfter } : {}) })
            res.end(JSON.stringify(answer.body ?? {}))
        })
    })
    await new Promise<void>(done => hub.listen(0, '127.0.0.1', done))
    hubOrigin = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`
})

afterEach(async () => {
    for (const worker of workers) worker.shutdown()
    for (const ws of sockets) ws.terminate()
    await new Promise(done => engine.close(done))
    hub.closeAllConnections()
    await new Promise(done => hub.close(done))
})

function startWorker(overrides: { paused?: boolean; pingIntervalMs?: number } = {}) {
    const worker = new ComputerWorker({
        dataDir,
        appVersion: '0.2.0',
        settings: { paused: overrides.paused ?? false, workDir, capabilities: ['shell'] },
        send: message => messages.push(message),
        env: Promise.resolve({ ...process.env, SHELL: '/bin/sh' }),
        pingIntervalMs: overrides.pingIntervalMs,
    })
    workers.push(worker)
    worker.setLinks([{ computerId: 'c1', hubOrigin, token: 'rrn_computer_secret' }])
    return worker
}

const lastState = (): WorkerLinkState | undefined =>
    messages
        .filter((message): message is Extract<WorkerToMain, { type: 'state' }> => message.type === 'state')
        .at(-1)
        ?.links.find(link => link.computerId === 'c1')

function request(ws: WebSocket, id: string, method: string, params: unknown): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
        const listener = (data: Buffer) => {
            const frame = JSON.parse(data.toString())
            if (frame.type === 'res' && frame.id === id) {
                ws.off('message', listener)
                resolve(frame)
            }
        }
        ws.on('message', listener)
        ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
}

describe('a linked computer', () => {
    it('trades its token for the socket, says hello with what it is, and goes online', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        expect(hubCalls[0]).toEqual({ authorization: 'Bearer rrn_computer_secret', body: { appVersion: '0.2.0' } })
        expect(hellos[0]).toMatchObject({ type: 'hello', protocol: { min: 1, max: 1 }, app: { version: '0.2.0' }, capabilities: ['shell'], paused: false, facts: { workDir, os: expect.any(String) } })
    })

    it.runIf(process.platform !== 'win32')('runs a command the engine sends in its working folder, and logs who asked', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        const answer = await request(sockets[0], 'r1', 'exec.run', { execId: 'e1', command: 'pwd && echo "été"', timeoutMs: 5_000, author: 'Claire' })
        expect(answer).toMatchObject({ ok: true, result: { exitCode: 0, stdout: `${realpathSync(workDir)}\nété\n` } })
        expect(messages.find(message => message.type === 'activity')).toMatchObject({ entry: { computerId: 'c1', author: 'Claire', kind: 'command', outcome: 'ok' } })
    })

    it('refuses what the person switched off, a method it does not know, and a request out of shape', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        expect(await request(sockets[0], 'r1', 'fs.list', { path: '/' })).toMatchObject({ ok: false, error: { code: 'capability_off' } })
        expect(await request(sockets[0], 'r2', 'teleport', {})).toMatchObject({ ok: false, error: { code: 'unsupported' } })
        expect(await request(sockets[0], 'r3', 'exec.run', { command: 'ls' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
        expect(await request(sockets[0], 'r4', 'exec.run', { execId: 'e', command: 'ls', cwd: '/no/such/folder', timeoutMs: 1000 })).toMatchObject({ ok: false, error: { code: 'not_found' } })
        expect(await request(sockets[0], 'r5', 'info', {})).toMatchObject({ ok: true, result: { paused: false } })
    })

    it.runIf(process.platform !== 'win32')('pauses at once: tells the engine, stops what runs, refuses the rest, and answers info still', async () => {
        const worker = startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        const running = request(sockets[0], 'r1', 'exec.run', { execId: 'e1', command: 'sleep 20', timeoutMs: 30_000 })
        await new Promise(done => setTimeout(done, 200))
        worker.setSettings({ paused: true, workDir, capabilities: ['shell'] })
        expect(await running).toMatchObject({ ok: false, error: { code: 'paused' } })
        await vi.waitFor(() => expect(frames).toContainEqual({ type: 'event', event: 'status', paused: true, capabilities: ['shell'] }))
        expect(await request(sockets[0], 'r2', 'exec.run', { execId: 'e2', command: 'echo hi', timeoutMs: 1000 })).toMatchObject({ ok: false, error: { code: 'paused' } })
        expect(await request(sockets[0], 'r3', 'info', {})).toMatchObject({ ok: true, result: { paused: true } })
    })

    it.runIf(process.platform !== 'win32')('cancels a command the engine gave up on', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        const running = request(sockets[0], 'r1', 'exec.run', { execId: 'e1', command: 'sleep 20', timeoutMs: 30_000 })
        await new Promise(done => setTimeout(done, 200))
        expect(await request(sockets[0], 'r2', 'exec.cancel', { execId: 'e1' })).toMatchObject({ ok: true, result: { cancelled: true } })
        expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } })
        expect(await request(sockets[0], 'r3', 'exec.cancel', { execId: 'nope' })).toMatchObject({ ok: true, result: { cancelled: false } })
    })

    it('stops for good when the hub says the link is gone', async () => {
        hubAnswer = () => ({ status: 401, body: { error: 'revoked' } })
        startWorker()
        await vi.waitFor(() => expect(messages).toContainEqual({ type: 'revoked', computerId: 'c1' }))
        await new Promise(done => setTimeout(done, 1500))
        expect(hubCalls).toHaveLength(1)
        expect(lastState()?.status).toBe('revoked')
    })

    it('stops for good when the engine closes with revoked', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        sockets[0].close(REMOTE_CLOSE.revoked, 'revoked')
        await vi.waitFor(() => expect(lastState()?.status).toBe('revoked'))
        await new Promise(done => setTimeout(done, 1500))
        expect(hubCalls).toHaveLength(1)
    })

    it('comes back after the engine drops it, asking the hub again', async () => {
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        sockets[0].terminate()
        await vi.waitFor(() => expect(lastState()?.status).toBe('offline'))
        await vi.waitFor(() => expect(hellos).toHaveLength(2), { timeout: 10_000 })
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'))
        expect(hubCalls).toHaveLength(2)
    })

    it('waits as long as the hub asks when the box cannot take it yet', async () => {
        hubAnswer = () => ({ status: 503, body: { error: 'engine-update' }, retryAfter: '120' })
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('offline'))
        const state = lastState()!
        expect(state.error).toBe('engine-update')
        expect(Date.parse(state.retryAt!) - Date.now()).toBeGreaterThan(100_000)
    })

    it('retries with a growing delay while the hub is down', async () => {
        hub.close()
        hub.closeAllConnections()
        startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('offline'))
        const first = Date.parse(lastState()!.retryAt!) - Date.parse(lastState()!.since)
        await vi.waitFor(() => expect(Date.parse(lastState()!.retryAt!) - Date.parse(lastState()!.since)).toBeGreaterThan(first), { timeout: 10_000 })
        expect(lastState()!.error).toMatch(/hub unreachable/)
    })

    it('hangs up on an engine that stopped answering its pings, and comes back', async () => {
        const deaf = new WebSocketServer({ port: 0, autoPong: false })
        let deafHellos = 0
        deaf.on('connection', ws => {
            ws.once('message', () => {
                deafHellos += 1
                ws.send(JSON.stringify({ type: 'welcome', protocol: 1, computerId: 'c1' }))
            })
        })
        await new Promise(done => deaf.once('listening', done))
        hubAnswer = () => ({ status: 200, body: { socketUrl: `ws://127.0.0.1:${(deaf.address() as AddressInfo).port}/remote/ws` } })
        startWorker({ pingIntervalMs: 100 })
        await vi.waitFor(() => expect(deafHellos).toBeGreaterThanOrEqual(2), { timeout: 10_000 })
        for (const client of deaf.clients) client.terminate()
        await new Promise(done => deaf.close(done))
    })

    it('drops a link the person removed, and connects one added', async () => {
        const worker = startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        worker.setLinks([])
        await vi.waitFor(() => expect(worker.states()).toEqual([]))
        worker.setLinks([{ computerId: 'c1', hubOrigin, token: 'rrn_computer_other' }])
        await vi.waitFor(() => expect(hubCalls.at(-1)?.authorization).toBe('Bearer rrn_computer_other'), { timeout: 10_000 })
    })

    it('says hello again with its new working folder', async () => {
        const worker = startWorker()
        await vi.waitFor(() => expect(lastState()?.status).toBe('online'), { timeout: 10_000 })
        worker.setSettings({ paused: false, workDir: join(dataDir, 'Elsewhere'), capabilities: ['shell'] })
        await vi.waitFor(() => expect(hellos.at(-1)).toMatchObject({ facts: { workDir: join(dataDir, 'Elsewhere') } }), { timeout: 10_000 })
    })
})
