'use server'

import { FOREMAN_INSTRUCTIONS_MAX, parseForemanInstructions } from '@rerun/contracts'

import { actorFromContext, signerIdOf } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { failure, failureOf } from '@/lib/i18n/action-error'
import { getForemanInstructions, putForemanInstructions, supportsForemanInstructions } from '@/lib/engine/client'
import type { ActionResult } from './space.actions'

// Every member reads and writes their own, admin or not: the engine reads them in their conversations
// only. `supported` is false on a box that predates them, which shows no field.
export async function readForemanInstructionsAction(): Promise<ActionResult<{ supported: boolean; instructions: string | null }>> {
    try {
        const ctx = await requireWorkspaceContext()
        const conn = await getWorkspaceConnection(ctx.workspace.id)
        if (!(await supportsForemanInstructions(conn))) return { ok: true, supported: false, instructions: null }
        return { ok: true, supported: true, instructions: await getForemanInstructions(conn, signerIdOf(actorFromContext(ctx))) }
    } catch (err) {
        return failureOf(err)
    }
}

/** An empty text clears them. */
export async function saveForemanInstructionsAction(raw: string): Promise<ActionResult<{ instructions: string | null }>> {
    try {
        const parsed = parseForemanInstructions(raw)
        if (!parsed.ok) return failure('foremanInstructionsTooLong', { max: FOREMAN_INSTRUCTIONS_MAX })
        const ctx = await requireWorkspaceContext()
        const instructions = await putForemanInstructions(await getWorkspaceConnection(ctx.workspace.id), signerIdOf(actorFromContext(ctx)), parsed.instructions)
        return { ok: true, instructions }
    } catch (err) {
        return failureOf(err, 'saveForemanInstructionsFailed')
    }
}
