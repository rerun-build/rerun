import { DESKTOP_WS_PATH, type DesktopViewMode } from '@rerun/contracts'

import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { DESKTOP_DIRECT, desktopRelayBase } from '@rerun/cloud/engines'
import { buildBaseUrl } from '@/lib/engine/base-url'
import { supportsDesktop } from '@/lib/engine/client'
import { mintDesktopTicket } from '@/lib/engine/desktop-ticket'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError, type ErrorCode } from '@/lib/i18n/action-error'

const DESKTOP_ENGINE_COLUMNS = ['engine_host', 'engine_api_key', 'host_id', 'box_index'] as const

const LOCAL_ENGINE = /^(localhost|127\.0\.0\.1)$/

export class DesktopUnavailableError extends AppError {
    constructor(code: ErrorCode) {
        super(code)
        this.name = 'DesktopUnavailableError'
    }
}

export type WorkspaceDesktop = { conn: EngineConnection; socketBase: string }

// Where a browser reaches the screens of the workspace's machine: an engine on this very machine
// (local development) directly, a box on one of Rerun Cloud's hosts through that host's relay, and a
// self-hosted engine on its own address.
async function socketBaseOf(conn: EngineConnection, hostId: string | null, boxIndex: number | null): Promise<string> {
    const engine = new URL(conn.baseUrl)
    if (LOCAL_ENGINE.test(engine.hostname)) return `ws://${engine.host}${DESKTOP_WS_PATH}`
    const relay = await desktopRelayBase(conn.baseUrl, hostId, boxIndex)
    if (relay) return `${relay}${DESKTOP_WS_PATH}`
    if (DESKTOP_DIRECT) return `${engine.protocol === 'https:' ? 'wss' : 'ws'}://${engine.host}${DESKTOP_WS_PATH}`
    throw new DesktopUnavailableError('desktopNotHereYet')
}

export async function resolveWorkspaceDesktop(workspaceId: number): Promise<WorkspaceDesktop> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'engine_pool', DESKTOP_ENGINE_COLUMNS, { claimed_by_workspace_id: workspaceId })
    if (!data?.engine_host) throw new NoEngineError()
    const conn = { baseUrl: buildBaseUrl(data.engine_host), apiKey: data.engine_api_key }
    if (!(await supportsDesktop(conn))) throw new DesktopUnavailableError('desktopNeedsUpdate')
    return { conn, socketBase: await socketBaseOf(conn, data.host_id, data.box_index) }
}

// Every agent of a machine answers on the same address: the ticket is what picks the screen.
export function desktopSocketUrl(desktop: WorkspaceDesktop, engineAgentId: string, mode: DesktopViewMode): string {
    return `${desktop.socketBase}?ticket=${encodeURIComponent(mintDesktopTicket(desktop.conn.apiKey ?? '', engineAgentId, mode))}`
}
