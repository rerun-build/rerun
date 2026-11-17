import { remoteComputerIdentitySchema, type RemoteComputerIdentity } from '@rerun/contracts'
import { readSignedTicket } from '../lib/signed-ticket.js'

// The hub hands a linked computer a one-minute ticket for one connection, signed with the box key
// (`lib/signed-ticket.ts`). It names the computer the hub vouches for: the engine never takes the
// computer's word for who it is. `aud` keeps a screen ticket from opening this socket and the other
// way round, and `jti` makes it good for one handshake only.
export const REMOTE_TICKET_AUDIENCE = 'remote'

export type RemoteTicket = { computer: RemoteComputerIdentity; jti: string }

const spent = new Map<string, number>()

function forgetExpired(now: number): void {
    for (const [jti, exp] of spent) if (exp < now) spent.delete(jti)
}

export function verifyRemoteTicket(raw: string | null | undefined, now: number = Date.now()): RemoteTicket | null {
    const claims = readSignedTicket(raw, now)
    if (!claims || claims.aud !== REMOTE_TICKET_AUDIENCE) return null
    if (typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 64) return null
    const computer = remoteComputerIdentitySchema.safeParse(claims.computer)
    if (!computer.success) return null
    forgetExpired(now)
    if (spent.has(claims.jti)) return null
    spent.set(claims.jti, claims.exp as number)
    return { computer: computer.data, jti: claims.jti }
}
