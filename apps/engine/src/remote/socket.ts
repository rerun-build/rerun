import { WebSocketServer, type WebSocket } from 'ws'
import { REMOTE_CLOSE, REMOTE_HELLO_TIMEOUT_MS, REMOTE_MAX_TEXT_FRAME_BYTES, negotiateRemoteProtocol, parseRemoteFrame, remoteHelloSchema, type RemoteComputerIdentity } from '@rerun/contracts'
import { refuseUpgrade, type UpgradeHandler } from '../http/upgrade.js'
import { logger } from '../lib/logger.js'
import { RemoteConnection } from './connection.js'
import { registerConnection } from './registry.js'
import { verifyRemoteTicket } from './ticket.js'

export type AcceptOptions = { helloTimeoutMs?: number; pingIntervalMs?: number }

// The computer speaks first: its hello says which protocol versions it speaks, what it offers and
// what it is. The engine answers with the version both use, then the socket is the computer's.
export function acceptComputer(ws: WebSocket, identity: RemoteComputerIdentity, { helloTimeoutMs = REMOTE_HELLO_TIMEOUT_MS, pingIntervalMs }: AcceptOptions = {}): void {
    const timer = setTimeout(() => ws.close(REMOTE_CLOSE.noHello, 'no hello'), helloTimeoutMs)
    ws.once('close', () => clearTimeout(timer))
    ws.once('message', (data, isBinary) => {
        clearTimeout(timer)
        const hello = isBinary ? null : parseRemoteFrame(remoteHelloSchema, data.toString())
        if (!hello) return ws.close(REMOTE_CLOSE.badHello, 'bad hello')
        const protocol = negotiateRemoteProtocol(hello.protocol)
        if (protocol === null) {
            logger.warn({ computerId: identity.id, offered: hello.protocol, app: hello.app.version }, 'remote computer speaks no protocol this engine does')
            return ws.close(REMOTE_CLOSE.protocol, 'protocol')
        }
        const connection = new RemoteConnection(ws, { computerId: identity.id, protocol, appVersion: hello.app.version, capabilities: hello.capabilities, facts: hello.facts, paused: hello.paused, runningJobs: hello.runningJobs }, { pingIntervalMs })
        // Welcomed once it is on record: a computer that believes itself online is listed as such.
        registerConnection(identity, connection)
            .catch(err => logger.warn({ err: String(err), computerId: identity.id }, 'remote computer not recorded'))
            .finally(() => {
                if (connection.open) ws.send(JSON.stringify({ type: 'welcome', protocol, computerId: identity.id }))
            })
    })
}

// The computer opens it from the desktop app with a ticket the hub minted for its link. The ticket,
// not the socket, says which computer this is.
export function remoteUpgradeHandler(): UpgradeHandler {
    const wss = new WebSocketServer({ noServer: true, maxPayload: REMOTE_MAX_TEXT_FRAME_BYTES })
    return (request, socket, head, url) => {
        const ticket = verifyRemoteTicket(url.searchParams.get('ticket'))
        if (!ticket) return refuseUpgrade(socket, '401 Unauthorized')
        wss.handleUpgrade(request, socket, head, ws => acceptComputer(ws, ticket.computer))
    }
}
