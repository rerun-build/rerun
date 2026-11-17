import { DESKTOP_WS_PATH, type DesktopViewMode } from '@rerun/contracts'

import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { engineSocketUrl } from '@/app/api/_services/engine-socket.service'
import { buildBaseUrl } from '@/lib/engine/base-url'
import { supportsDesktop } from '@/lib/engine/client'
import { mintDesktopTicket } from '@/lib/engine/engine-ticket'
import type { EngineConnection } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError, type ErrorCode } from '@/lib/i18n/action-error'

const DESKTOP_ENGINE_COLUMNS = ['engine_host', 'engine_api_key', 'host_id', 'box_index'] as const

export class DesktopUnavailableError extends AppError {
    constructor(code: ErrorCode) {
        super(code)
        this.name = 'DesktopUnavailableError'
    }
}

export type WorkspaceDesktop = { conn: EngineConnection; socketBase: string }

async function socketBaseOf(conn: EngineConnection, hostId: string | null, boxIndex: number | null): Promise<string> {
    const url = await engineSocketUrl(conn, hostId, boxIndex, DESKTOP_WS_PATH)
    if (!url) throw new DesktopUnavailableError('desktopNotHereYet')
    return url
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
