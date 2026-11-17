import { DESKTOP_DIRECT, desktopRelayBase } from '@rerun/cloud/engines'
import type { EngineConnection } from '@/lib/engine/types'

const LOCAL_ENGINE = /^(localhost|127\.0\.0\.1)$/

// Where a socket from outside reaches a path of the workspace's machine: an engine on this very
// machine (local development) directly, a box on one of Rerun Cloud's hosts through that host's
// relay, and a self-hosted engine on its own address. Null when none of them can be reached from
// outside (a box on a host with no relay).
export async function engineSocketUrl(conn: EngineConnection, hostId: string | null, boxIndex: number | null, path: string): Promise<string | null> {
    const engine = new URL(conn.baseUrl)
    if (LOCAL_ENGINE.test(engine.hostname)) return `ws://${engine.host}${path}`
    const relay = await desktopRelayBase(conn.baseUrl, hostId, boxIndex)
    if (relay) return `${relay}${path}`
    if (DESKTOP_DIRECT) return `${engine.protocol === 'https:' ? 'wss' : 'ws'}://${engine.host}${path}`
    return null
}
