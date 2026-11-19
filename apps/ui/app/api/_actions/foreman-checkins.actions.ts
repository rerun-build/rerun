'use server'

import { FOREMAN_AGENT_ID, type ForemanCheckins, type Proactive } from '@rerun/contracts'

import { requireAdminContext } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { failureOf } from '@/lib/i18n/action-error'
import { getForemanCheckins, patchAgent, runForemanCheckin, supportsForemanCheckins } from '@/lib/engine/client'
import type { ActionResult } from './space.actions'

// The check-ins of the Chief of Staff, as its card shows them to an admin. Null on a box that has
// none yet, or none to reach: the section stays out of the card.
export async function loadForemanCheckinsAction(): Promise<ForemanCheckins | null> {
    try {
        const ctx = await requireAdminContext()
        const conn = await getWorkspaceConnection(ctx.workspace.id)
        if (!(await supportsForemanCheckins(conn))) return null
        return await getForemanCheckins(conn)
    } catch {
        return null
    }
}

export async function updateForemanCheckinsAction(proactive: Proactive): Promise<ActionResult<{ proactive: Proactive }>> {
    try {
        const ctx = await requireAdminContext()
        const detail = await patchAgent(await getWorkspaceConnection(ctx.workspace.id), FOREMAN_AGENT_ID, { proactive })
        return { ok: true, proactive: detail.config.proactive }
    } catch (err) {
        return failureOf(err, 'saveCheckinsFailed')
    }
}

export async function runForemanCheckinAction(): Promise<ActionResult> {
    try {
        const ctx = await requireAdminContext()
        await runForemanCheckin(await getWorkspaceConnection(ctx.workspace.id))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'runCheckinFailed')
    }
}
