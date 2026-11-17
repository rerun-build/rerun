import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-remote-socket-'))
process.env.RERUN_API_KEY = 'box-key'
process.env.RERUN_REMOTE_COMPUTERS = 'on'

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { WebSocket, WebSocketServer } = await import('ws')
const { REMOTE_CLOSE, REMOTE_WS_PATH } = await import('@rerun/contracts')
const { attachUpgradeRouter } = await import('../http/upgrade.js')
const { remoteUpgradeHandler, acceptComputer } = await import('./socket.js')
const { forgetComputer, listComputerViews, liveConnection, liveConnectionCount } = await import('./registry.js')
const { RemoteCallError } = await import('./connection.js')
const { getComputer } = await import('./store.js')
const { remoteDir } = await import('../config/paths.js')
const { connectFakeComputer, FakeRemoteError } = await import('./__fixtures__/fake-computer.js')

const computer = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
let jti = 0

function ticket(claims: Record<string, unknown> = {}): string {
    const payload = Buffer.from(JSON.stringify({ aud: 'remote', exp: Date.now() + 60_000, jti: `j${++jti}`, computer, ...claims })).toString('base64url')
    return `${payload}.${createHmac('sha256', 'box-key').update(payload).digest('base64url')}`
}

let http: Server
let base: string

beforeEach(async () => {
    await rm(remoteDir(), { recursive: true, force: true })
    http = createHttpServer((_request, response) => response.end('http'))
    attachUpgradeRouter(http, { [REMOTE_WS_PATH]: remoteUpgradeHandler() })
    await new Promise<void>(done => http.listen(0, '127.0.0.1', done))
    base = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`
})

afterEach(async () => {
    for (const { id } of await listComputerViews()) await forgetComputer(id)
    await forgetComputer(computer.id)
    http.closeAllConnections()
    await new Promise(done => http.close(done))
})

const url = (raw = ticket()) => `${base}${REMOTE_WS_PATH}?ticket=${encodeURIComponent(raw)}`

function status(path: string): Promise<number | null> {
    return new Promise(done => {
        const ws = new WebSocket(`${base}${path}`)
        ws.once('open', () => {
            ws.close()
            done(null)
        })
        ws.once('unexpected-response', (_request, response) => done(response.statusCode ?? null))
        ws.once('error', () => {})
    })
}

async function connected(options: Parameters<typeof connectFakeComputer>[1] = {}) {
    const fake = await connectFakeComputer(url(), options)
    await fake.welcome
    await vi.waitFor(() => expect(liveConnection(computer.id)).not.toBeNull())
    return fake
}

describe('the computer socket', () => {
    it('welcomes a computer with the version both speak, and lists it online with what it said', async () => {
        const fake = await connectFakeComputer(url(), { protocol: { min: 1, max: 9 }, appVersion: '0.3.0' })
        expect(await fake.welcome).toEqual({ protocol: 1, computerId: 'c1' })
        await vi.waitFor(async () => expect((await listComputerViews())[0]).toMatchObject({ ...computer, online: true, paused: false, appVersion: '0.3.0', protocol: 1, capabilities: ['shell', 'files', 'jobs'] }))
        const [view] = await listComputerViews()
        expect(view.facts).toMatchObject({ os: 'mac', shell: 'zsh' })
        expect(view.settings).toEqual({ mode: 'remember', unattended: true, allowedPrograms: [], allowedFolders: [], screenAlways: false })
        expect(liveConnectionCount()).toBe(1)
        await fake.close()
        await vi.waitFor(async () => expect((await listComputerViews())[0]?.online).toBe(false))
        expect((await getComputer('c1'))?.lastSeenAt).toEqual(expect.any(String))
    })

    it('refuses a missing, forged, replayed or screen ticket before the socket opens', async () => {
        expect(await status(REMOTE_WS_PATH)).toBe(401)
        expect(await status(`${REMOTE_WS_PATH}?ticket=bad`)).toBe(401)
        const raw = ticket()
        const first = await connectFakeComputer(url(raw))
        await first.welcome
        expect(await status(`${REMOTE_WS_PATH}?ticket=${encodeURIComponent(raw)}`)).toBe(401)
        const screen = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, agent: 'a1' })).toString('base64url')
        expect(await status(`${REMOTE_WS_PATH}?ticket=${screen}.${createHmac('sha256', 'box-key').update(screen).digest('base64url')}`)).toBe(401)
        await first.close()
    })

    it('upgrades nothing but the routes it was given', async () => {
        expect(await status(`/desktop/ws?ticket=${encodeURIComponent(ticket())}`)).toBe(404)
        expect(await status(`${REMOTE_WS_PATH}/x?ticket=${encodeURIComponent(ticket())}`)).toBe(404)
        expect(await status(`/__proto__?ticket=${encodeURIComponent(ticket())}`)).toBe(404)
    })

    it('hangs up on a hello that is not one, in binary, or that speaks no common protocol', async () => {
        expect((await (await connectFakeComputer(url(), { rawHello: '{"type":"hello"}' })).closed).code).toBe(REMOTE_CLOSE.badHello)
        expect((await (await connectFakeComputer(url(), { rawHello: 'not json' })).closed).code).toBe(REMOTE_CLOSE.badHello)
        const binary = await connectFakeComputer(url(), { skipHello: true })
        binary.ws.send(Buffer.from([1, 2, 3]))
        expect((await binary.closed).code).toBe(REMOTE_CLOSE.badHello)
        expect((await (await connectFakeComputer(url(), { protocol: { min: 2, max: 3 } })).closed).code).toBe(REMOTE_CLOSE.protocol)
        expect(await listComputerViews()).toEqual([])
    })

    it('hangs up on a computer that says nothing', async () => {
        const wss = new WebSocketServer({ port: 0 })
        wss.on('connection', ws => acceptComputer(ws, computer, { helloTimeoutMs: 50 }))
        const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
        const code = await new Promise<number>(done => ws.once('close', done))
        expect(code).toBe(REMOTE_CLOSE.noHello)
        await new Promise(done => wss.close(done))
    })

    it('replaces the socket of a computer that connects again, and keeps it online', async () => {
        const first = await connected()
        const second = await connectFakeComputer(url())
        await second.welcome
        expect((await first.closed).code).toBe(REMOTE_CLOSE.replaced)
        await vi.waitFor(async () => expect((await listComputerViews())[0]?.online).toBe(true))
        expect(liveConnectionCount()).toBe(1)
        await second.close()
    })

    it('closes the socket of a computer the hub unlinked, with the code that keeps it from coming back', async () => {
        const fake = await connected()
        expect(await forgetComputer('c1')).toBe(true)
        expect((await fake.closed).code).toBe(REMOTE_CLOSE.revoked)
        expect(await listComputerViews()).toEqual([])
        expect(await forgetComputer('c1')).toBe(false)
    })

    it('follows the pause the person sets on the computer, and the capabilities it switches off', async () => {
        const fake = await connected()
        fake.status(true, ['shell'])
        await vi.waitFor(async () => expect((await listComputerViews())[0]).toMatchObject({ paused: true, capabilities: ['shell'] }))
        fake.status(false)
        await vi.waitFor(async () => expect((await listComputerViews())[0]).toMatchObject({ paused: false, capabilities: ['shell'] }))
        await fake.close()
    })
})

describe('calling a computer', () => {
    it('sends a request the computer answers, read back in the shape of the method', async () => {
        const fake = await connected({ handlers: { 'exec.run': ({ command }) => ({ exitCode: 0, stdout: `ran ${command}`, stderr: '', truncated: false, timedOut: false, durationMs: 12 }) } })
        const result = await liveConnection('c1')!.call('exec.run', { execId: 'e1', command: 'ffmpeg -version', timeoutMs: 1000 })
        expect(result).toEqual({ exitCode: 0, stdout: 'ran ffmpeg -version', stderr: '', truncated: false, timedOut: false, durationMs: 12 })
        expect(fake.requests).toEqual([{ method: 'exec.run', params: { execId: 'e1', command: 'ffmpeg -version', timeoutMs: 1000 } }])
        await fake.close()
    })

    it('turns an error the computer sends into an error with its code', async () => {
        const fake = await connected({
            handlers: {
                'fs.read': () => {
                    throw new FakeRemoteError('outside_workdir', 'outside')
                },
            },
        })
        const failed = liveConnection('c1')!.call('fs.read', { path: '/etc/passwd' })
        await expect(failed).rejects.toBeInstanceOf(RemoteCallError)
        await expect(failed).rejects.toMatchObject({ code: 'outside_workdir', message: 'outside' })
        await expect(liveConnection('c1')!.call('job.list', {})).rejects.toMatchObject({ code: 'unsupported' })
        await fake.close()
    })

    it('refuses an answer in a shape it does not read', async () => {
        const fake = await connected({ handlers: { 'job.list': () => ({ jobs: 'none' }) } })
        await expect(liveConnection('c1')!.call('job.list', {})).rejects.toMatchObject({ code: 'invalid' })
        await fake.close()
    })

    it('never sends what the computer does not offer, nor parameters out of shape', async () => {
        const fake = await connected({ capabilities: ['shell'] })
        await expect(liveConnection('c1')!.call('fs.list', { path: '/' })).rejects.toMatchObject({ code: 'capability_off' })
        await expect(liveConnection('c1')!.call('exec.run', { execId: 'e', command: '', timeoutMs: 1 })).rejects.toMatchObject({ code: 'invalid' })
        expect(fake.requests).toEqual([])
        await fake.close()
    })

    it('stops waiting after the time limit, on an abort, and when the computer goes', async () => {
        const fake = await connected({ handlers: { 'job.list': () => new Promise(() => {}) } })
        const connection = liveConnection('c1')!
        await expect(connection.call('job.list', {}, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' })
        const abort = new AbortController()
        const aborted = connection.call('job.list', {}, { signal: abort.signal })
        abort.abort()
        await expect(aborted).rejects.toMatchObject({ code: 'cancelled' })
        await expect(connection.call('job.list', {}, { signal: abort.signal })).rejects.toMatchObject({ code: 'cancelled' })
        const hanging = expect(connection.call('job.list', {})).rejects.toMatchObject({ code: 'disconnected' })
        await vi.waitFor(() => expect(connection.pendingCount).toBe(1))
        await fake.close()
        await hanging
        await expect(connection.call('job.list', {})).rejects.toMatchObject({ code: 'disconnected' })
        expect(connection.open).toBe(false)
    })

    it('ignores frames it cannot read and answers to requests it never sent', async () => {
        const fake = await connected({ handlers: { 'job.list': () => ({ jobs: [] }) } })
        fake.ws.send('{"type":"res","id":"nobody","ok":true,"result":{}}')
        fake.ws.send('garbage')
        fake.ws.send(Buffer.from([1]))
        expect(await liveConnection('c1')!.call('job.list', {})).toEqual({ jobs: [] })
        await fake.close()
    })

    it('hangs up on a computer that stops answering pings', async () => {
        const wss = new WebSocketServer({ port: 0 })
        wss.on('connection', ws => acceptComputer(ws, computer, { pingIntervalMs: 20 }))
        const fake = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, { autoPong: false })
        await fake.welcome
        await vi.waitFor(() => expect(liveConnection('c1')).not.toBeNull())
        const { code } = await fake.closed
        expect([REMOTE_CLOSE.unresponsive, 1006]).toContain(code)
        await vi.waitFor(() => expect(liveConnection('c1')).toBeNull())
        await new Promise(done => wss.close(done))
    })

    it('keeps a computer that answers its pings', async () => {
        const wss = new WebSocketServer({ port: 0 })
        wss.on('connection', ws => acceptComputer(ws, computer, { pingIntervalMs: 20 }))
        const fake = await connectFakeComputer(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`)
        await fake.welcome
        await new Promise(done => setTimeout(done, 150))
        expect(liveConnection('c1')).not.toBeNull()
        await fake.close()
        await new Promise(done => wss.close(done))
    })

    it('tells the computer a finished job was received', async () => {
        const fake = await connected()
        liveConnection('c1')!.acknowledgeJob('job-1')
        await vi.waitFor(() => expect(fake.acks).toEqual(['job-1']))
        await fake.close()
    })
})
