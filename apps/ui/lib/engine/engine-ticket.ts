import { createHmac, randomBytes } from 'crypto'

import { DESKTOP_TICKET_TTL_MS, REMOTE_TICKET_TTL_MS, type DesktopViewMode, type RemoteComputerIdentity } from '@rerun/contracts'

// The engine checks these in apps/engine/src/lib/signed-ticket.ts with the same key, so the Box key
// itself never leaves the hub: what does is good for one WebSocket handshake within the minute.
function signEngineTicket(engineApiKey: string, claims: Record<string, unknown>): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${createHmac('sha256', engineApiKey).update(payload).digest('base64url')}`
}

// The screen of the one agent it names. The mode tells the engine whether its holder drives the
// screen, which keeps the agent's own hands off it, or only watches.
export function mintDesktopTicket(engineApiKey: string, engineAgentId: string, mode: DesktopViewMode, now: number = Date.now()): string {
    return signEngineTicket(engineApiKey, { exp: now + DESKTOP_TICKET_TTL_MS, agent: engineAgentId, mode })
}

// The socket of a linked computer: the engine takes the computer to be the one named here, never
// what the computer says, and spends the ticket on its first handshake (`jti`).
export function mintRemoteTicket(engineApiKey: string, computer: RemoteComputerIdentity, now: number = Date.now()): string {
    return signEngineTicket(engineApiKey, { aud: 'remote', exp: now + REMOTE_TICKET_TTL_MS, jti: randomBytes(16).toString('base64url'), computer })
}
