import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer, url: URL) => void

export function refuseUpgrade(socket: Duplex, status: string): void {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
}

// The only routes reached by a WebSocket, each behind a ticket of its own. Any other path is refused
// before a byte of the request is read.
export function attachUpgradeRouter(server: Server, routes: Record<string, UpgradeHandler>): void {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = new URL(request.url ?? '/', 'http://engine')
        const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined
        if (!route) return refuseUpgrade(socket, '404 Not Found')
        route(request, socket, head, url)
    })
}
