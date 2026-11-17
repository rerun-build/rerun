import { desktopViewModeSchema, type DesktopViewMode } from '@rerun/contracts'
import { readSignedTicket } from '../lib/signed-ticket.js'

// The ticket names the one agent whose screen it opens and whether its holder drives it or only
// watches. See `lib/signed-ticket.ts` for how it is signed.
export type DesktopTicket = { agentId: string; mode: DesktopViewMode }

export function verifyDesktopTicket(raw: string | null | undefined, now: number = Date.now()): DesktopTicket | null {
    const claims = readSignedTicket(raw, now)
    if (!claims || typeof claims.agent !== 'string' || !claims.agent) return null
    return { agentId: claims.agent, mode: desktopViewModeSchema.catch('drive').parse(claims.mode) }
}
