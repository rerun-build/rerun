import { rewindAgentReportSchema, type RewindAgentReport } from '@moldwright/contracts'

import { request } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'

export async function getAgentRewind(conn: EngineConnection, agentId: string, from: string, to: string, signal?: AbortSignal): Promise<RewindAgentReport> {
    const qs = new URLSearchParams({ from, to })
    return request(conn, `/agents/${encodeURIComponent(agentId)}/rewind?${qs}`, { method: 'GET', signal }, d => rewindAgentReportSchema.parse(d))
}
