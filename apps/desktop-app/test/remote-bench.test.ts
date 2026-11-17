import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorkerLinkState, WorkerToMain } from '../src/shared/remote-worker'
import { ComputerWorker } from '../src/worker/computer-worker'

// The real engine (from its sources) and the real worker, with a hub that does what the real one
// does on /api/remote-computers/connect: it signs a one-minute ticket naming the computer with the box
// key. What it proves is that both ends speak the same protocol, over a real socket, through a
// restart of the engine. Needs the engine's dependencies: a checkout that installed only the shell skips it.

const ENGINE = resolve(import.meta.dirname, '../../engine')
const TSX = resolve(ENGINE, 'node_modules/.bin/tsx')
const available = existsSync(TSX)
const KEY = randomBytes(24).toString('hex')
const computer = { id: 'bench-computer', handle: 'bench-pc', name: 'Bench PC' }

let engine: ChildProcess | null = null
let port = 0
let hub: Server
let hubOrigin = ''
const dataDir = mkdtempSync(join(tmpdir(), 'rerun-bench-engine-'))
const workerDir = mkdtempSync(join(tmpdir(), 'rerun-bench-worker-'))
const messages: WorkerToMain[] = []
let worker: ComputerWorker | null = null

function freePort(): Promise<number> {
    return new Promise(done => {
        const server = createNetServer()
        server.listen(0, '127.0.0.1', () => {
            const { port: free } = server.address() as AddressInfo
            server.close(() => done(free))
        })
    })
}

function ticket(): string {
    const payload = Buffer.from(JSON.stringify({ aud: 'remote', exp: Date.now() + 60_000, jti: randomBytes(16).toString('base64url'), computer })).toString('base64url')
    return `${payload}.${createHmac('sha256', KEY).update(payload).digest('base64url')}`
}

async function startEngine(): Promise<void> {
    engine = spawn(TSX, ['src/cli/bin.ts', 'run'], {
        cwd: ENGINE,
        env: { ...process.env, RERUN_DATA_DIR: dataDir, RERUN_PORT: String(port), RERUN_HOST: '127.0.0.1', RERUN_API_KEY: KEY, RERUN_REMOTE_COMPUTERS: 'on', RERUN_DESKTOP: 'off', RERUN_HUB_BASE_URL: '', RERUN_LOG_LEVEL: 'warn' },
        stdio: ['ignore', 'inherit', 'inherit'],
        // tsx runs the engine in a child of its own: the whole group goes when the bench kills it.
        detached: true,
    })
    await vi.waitFor(
        async () => {
            const res = await fetch(`http://127.0.0.1:${port}/health`)
            expect(res.ok).toBe(true)
        },
        { timeout: 60_000, interval: 250 },
    )
}

async function stopEngine(): Promise<void> {
    const running = engine
    engine = null
    if (!running || running.exitCode !== null) return
    await new Promise(done => {
        running.once('exit', done)
        process.kill(-running.pid!, 'SIGKILL')
    })
}

const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' } })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const engineView = async () => ((await api('/remote/computers')).body.computers as Record<string, unknown>[]).find(entry => entry.id === computer.id)

const linkState = (): WorkerLinkState | undefined =>
    messages
        .filter((message): message is Extract<WorkerToMain, { type: 'state' }> => message.type === 'state')
        .at(-1)
        ?.links[0]

beforeAll(async () => {
    if (!available) return
    port = await freePort()
    hub = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ socketUrl: `ws://127.0.0.1:${port}/remote/ws?ticket=${encodeURIComponent(ticket())}`, computer }))
    })
    await new Promise<void>(done => hub.listen(0, '127.0.0.1', done))
    hubOrigin = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`
    await startEngine()
}, 90_000)

afterAll(async () => {
    worker?.shutdown()
    await stopEngine()
    hub?.closeAllConnections()
    hub?.close()
})

describe.runIf(available)('a linked computer against the real engine', () => {
    it('connects, and the engine lists it online with what it said about itself', async () => {
        worker = new ComputerWorker({ dataDir: workerDir, appVersion: '0.9.0', settings: { paused: false, workDir: join(workerDir, 'Rerun'), capabilities: ['shell'] }, send: message => messages.push(message) })
        worker.setLinks([{ computerId: computer.id, hubOrigin, token: 'rrn_computer_bench' }])
        await vi.waitFor(() => expect(linkState()?.status).toBe('online'), { timeout: 30_000 })
        const view = await engineView()
        expect(view).toMatchObject({ ...computer, online: true, paused: false, appVersion: '0.9.0', protocol: 1, capabilities: ['shell'], facts: { workDir: join(workerDir, 'Rerun') } })
    }, 60_000)

    it('carries the pause the person sets on the computer to the engine', async () => {
        worker!.setSettings({ paused: true, workDir: join(workerDir, 'Rerun'), capabilities: ['shell'] })
        await vi.waitFor(async () => expect(await engineView()).toMatchObject({ paused: true }), { timeout: 10_000 })
        worker!.setSettings({ paused: false, workDir: join(workerDir, 'Rerun'), capabilities: ['shell'] })
        await vi.waitFor(async () => expect(await engineView()).toMatchObject({ paused: false }), { timeout: 10_000 })
    }, 30_000)

    it('comes back online on its own after the engine is killed and restarted', async () => {
        await stopEngine()
        await vi.waitFor(() => expect(linkState()?.status).toBe('offline'), { timeout: 10_000 })
        await startEngine()
        await vi.waitFor(() => expect(linkState()?.status).toBe('online'), { timeout: 90_000 })
        expect(await engineView()).toMatchObject({ online: true })
    }, 180_000)

    it('stops for good once the hub unlinks it on the engine', async () => {
        expect((await api(`/remote/computers/${computer.id}`, { method: 'DELETE' })).status).toBe(200)
        await vi.waitFor(() => expect(messages).toContainEqual({ type: 'revoked', computerId: computer.id }), { timeout: 10_000 })
        expect(await engineView()).toBeUndefined()
    }, 30_000)
})
