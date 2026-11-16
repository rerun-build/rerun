import 'server-only'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { z } from 'zod'

import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { request, supportsForemanWakes } from '@/lib/engine/client'

export type ForemanSignal = { kind: string; summary: string; memberId?: string | null; itemId?: string | null; delayMinutes?: number }

// What the hub knows and the box does not, handed to the Chief of Staff's signals: it may wake on it.
// Never in the way of what caused it: a box without wakes, or one that cannot be reached, is skipped.
export async function sendForemanSignal(workspaceId: number, signal: ForemanSignal): Promise<void> {
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine || !(await supportsForemanWakes(engine.conn))) return
        await request(engine.conn, `/agents/${FOREMAN_AGENT_ID}/wake/signals`, { method: 'POST', body: JSON.stringify(signal) }, data => z.object({ queued: z.boolean() }).parse(data))
    } catch (err) {
        console.warn(`[foreman] signal ${signal.kind} not delivered:`, err instanceof Error ? err.message : err)
    }
}
