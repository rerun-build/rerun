import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net'
import { vi } from 'vitest'

const state = vi.hoisted(() => ({ vncPort: 0, drivers: [] as string[], driverInputs: 0, viewers: [] as string[], desktops: [] as string[], agents: ['a1'], desktopError: null as Error | null }))

vi.mock('./session.js', () => ({
    ensureDesktop: async (agentId: string) => {
        if (state.desktopError) throw state.desktopError
        state.desktops.push(agentId)
        return { display: ':42', vncPort: state.vncPort }
    },
    viewerJoined: (agentId: string) => {
        state.viewers.push(agentId)
    },
    viewerLeft: (agentId: string) => {
        state.viewers.splice(state.viewers.indexOf(agentId), 1)
    },
    driverJoined: (agentId: string) => {
        state.drivers.push(agentId)
    },
    driverLeft: (agentId: string) => {
        state.drivers.splice(state.drivers.indexOf(agentId), 1)
    },
    driverActed: () => {
        state.driverInputs += 1
    },
}))
vi.mock('./ticket.js', () => ({
    verifyDesktopTicket: (raw: string | null) => {
        const [, mode, agentId] = /^(for|watch)-(.+)$/.exec(raw ?? '') ?? []
        return agentId ? { agentId, mode: mode === 'watch' ? 'watch' : 'drive' } : null
    },
}))
vi.mock('../agents/loader.js', () => ({ agentExists: (id: string) => state.agents.includes(id) }))
vi.mock('../lib/logger.js', () => ({ logger: { info() {}, warn() {} } }))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { WebSocket } = await import('ws')
const { desktopUpgradeHandler } = await import('./bridge.js')
const { attachUpgradeRouter } = await import('../http/upgrade.js')

let http: Server
let vnc: ReturnType<typeof createTcpServer>
let vncSockets: Socket[]
let base: string

const listen = (server: { listen: (port: number, host: string, done: () => void) => unknown; address: () => unknown }) =>
    new Promise<number>(done => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)))

function open(path: string): Promise<{ ws: InstanceType<typeof WebSocket> | null; status: number | null }> {
    return new Promise(done => {
        const ws = new WebSocket(`${base}${path}`)
        ws.once('open', () => done({ ws, status: null }))
        ws.once('unexpected-response', (_request, response) => done({ ws: null, status: response.statusCode ?? null }))
        ws.once('error', () => {})
    })
}

beforeEach(async () => {
    state.viewers.length = 0
    state.drivers.length = 0
    state.driverInputs = 0
    state.desktops.length = 0
    state.desktopError = null
    vncSockets = []
    vnc = createTcpServer(socket => {
        vncSockets.push(socket)
        socket.write('RFB 003.008\n')
        socket.on('data', chunk => socket.write(chunk))
    })
    state.vncPort = await listen(vnc)
    http = createHttpServer((_request, response) => response.end('http'))
    attachUpgradeRouter(http, { '/desktop/ws': desktopUpgradeHandler() })
    base = `ws://127.0.0.1:${await listen(http)}`
})

afterEach(async () => {
    for (const socket of vncSockets) socket.destroy()
    await new Promise(done => vnc.close(done))
    http.closeAllConnections()
    await new Promise(done => http.close(done))
})

describe('desktop bridge', () => {
    it('pipes the VNC stream of the agent the ticket names both ways, and counts the viewer on that screen', async () => {
        const { ws } = await open('/desktop/ws?ticket=for-a1')
        const received: string[] = []
        const echoed = new Promise<void>(done =>
            ws!.on('message', data => {
                received.push(data.toString())
                if (received.join('').includes('ping')) done()
            }),
        )
        ws!.send(Buffer.from('ping'))
        await echoed
        expect(received.join('')).toBe('RFB 003.008\nping')
        expect(state.desktops).toEqual(['a1'])
        expect(state.viewers).toEqual(['a1'])
        const closed = new Promise(done => ws!.once('close', done))
        ws!.close()
        await closed
        await vi.waitFor(() => expect(state.viewers).toEqual([]))
    })

    it('refuses a missing or invalid ticket before touching the desktop', async () => {
        expect((await open('/desktop/ws')).status).toBe(401)
        expect((await open('/desktop/ws?ticket=bad')).status).toBe(401)
        expect(state.viewers).toEqual([])
        expect(vncSockets).toHaveLength(0)
    })

    it('refuses a ticket for an agent this box does not have, whatever the query asks for', async () => {
        expect((await open('/desktop/ws?ticket=for-gone')).status).toBe(401)
        expect((await open('/desktop/ws?ticket=for-gone&agent=a1')).status).toBe(401)
        expect(state.desktops).toEqual([])
    })

    it('upgrades nothing but the desktop path', async () => {
        expect((await open('/agents/a/chat?ticket=for-a1')).status).toBe(404)
        expect((await open('/desktop/ws/extra?ticket=for-a1')).status).toBe(404)
    })

    it('closes the socket when the desktop cannot start', async () => {
        state.desktopError = new Error('no display')
        const { ws } = await open('/desktop/ws?ticket=for-a1')
        const code = await new Promise<number>(done => ws!.once('close', done))
        expect(code).toBe(1011)
        expect(state.viewers).toEqual([])
    })

    it('drops the viewer when the VNC server goes away', async () => {
        const { ws } = await open('/desktop/ws?ticket=for-a1')
        await vi.waitFor(() => expect(vncSockets).toHaveLength(1))
        const closed = new Promise(done => ws!.once('close', done))
        vncSockets[0]!.destroy()
        await closed
        expect(state.viewers).toEqual([])
    })

    const pointerEvent = Buffer.from([5, 1, 0, 10, 0, 20])
    const pointerHover = Buffer.from([5, 0, 0, 10, 0, 20])
    const keyEvent = Buffer.from([4, 1, 0, 0, 0, 0, 0, 97])
    const updateRequest = Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 0])

    async function echoedBack(ws: InstanceType<typeof WebSocket>, bytes: number): Promise<void> {
        let seen = 0
        await new Promise<void>(done =>
            ws.on('message', data => {
                seen += (data as Buffer).length
                if (seen >= 'RFB 003.008\n'.length + bytes) done()
            }),
        )
    }

    it('counts a person who drives, notes each click and key but no hover, and forgets them when they leave', async () => {
        const { ws } = await open('/desktop/ws?ticket=for-a1')
        await vi.waitFor(() => expect(state.drivers).toEqual(['a1']))
        const echoed = echoedBack(ws!, pointerEvent.length + pointerHover.length + keyEvent.length + updateRequest.length + 1)
        ws!.send(pointerEvent)
        ws!.send(pointerHover)
        ws!.send(keyEvent)
        ws!.send(updateRequest)
        ws!.send(Buffer.from([1]))
        await echoed
        expect(state.driverInputs).toBe(2)
        ws!.close()
        await vi.waitFor(() => expect(state.drivers).toEqual([]))
    })

    it('lets a person who only watches see the screen without counting as a driver', async () => {
        const { ws } = await open('/desktop/ws?ticket=watch-a1')
        await vi.waitFor(() => expect(state.viewers).toEqual(['a1']))
        const echoed = echoedBack(ws!, pointerEvent.length)
        ws!.send(pointerEvent)
        await echoed
        expect(state.drivers).toEqual([])
        expect(state.driverInputs).toBe(0)
        ws!.close()
        await vi.waitFor(() => expect(state.viewers).toEqual([]))
    })
})
