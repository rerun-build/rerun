'use server'

import { AppError, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import { assertAdminUser } from '@/lib/auth/admin'
import { actorFromContext, requireLightSessionActor } from '@/app/api/_auth/access'
import { requireWorkspaceContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import { createBox, deleteBox, renameBox } from '@/app/api/_services/box.service'
import { findWorkspaceEngine, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { restartManagedEngine } from '@rerun/cloud/engines'
import type { SpaceSide } from '@/lib/board/space-layout'

// Server Actions can't surface thrown error messages in production: Next.js
// redacts them to a generic "an error occurred in the Server Components render"
// digest. So these actions return the error as a serializable value instead,
// and the client re-throws it (where the real message survives) for the UI.
// A refusal may carry an `errors` code the screen translates (lib/i18n/action-error.ts).
export type ActionResult<T = unknown> = ({ ok: true } & T) | ActionFailure

export async function claimSpaceAction(params: { workspaceId: number; name?: string | null; from?: { spaceId: string; side: SpaceSide } }): Promise<ActionResult<{ spaceId: string; colStart: number; rowStart: number }>> {
    try {
        // Trust the session for the workspace, not the client-supplied workspaceId.
        const ctx = await requireWorkspaceContext()
        return await createBox({ workspaceId: ctx.workspace.id, userId: ctx.userId, actor: actorFromContext(ctx), name: params.name, from: params.from })
    } catch (err) {
        return failureOf(err, 'createBoxFailed')
    }
}

export async function renameSpaceAction(spaceId: string, newName: string): Promise<void> {
    await renameBox(await requireLightSessionActor(), spaceId, newName)
}

export async function deleteSpaceAction(spaceId: string): Promise<ActionResult> {
    try {
        await deleteBox(await requireLightSessionActor(), spaceId)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'deleteBoxFailed')
    }
}

// The machine belongs to the workspace, so these two act on the workspace, whichever Box the
// button was pressed from.
async function managedInstanceId(): Promise<string> {
    await assertAdminUser()
    const engine = await findWorkspaceEngine(await requireWorkspaceId())
    if (!engine) throw new NoEngineError()
    if (!engine.managed) throw new AppError('engineNotManaged')
    return engine.instanceId
}

// Restarts the workspace's VPS via a Trigger task: stop/start is long and the public IP changes,
// so it is re-mapped onto engine_pool asynchronously once the box is back up.
export async function restartWorkspaceEngineAction(): Promise<ActionResult> {
    try {
        await restartManagedEngine(await managedInstanceId())
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'restartMachineFailed')
    }
}
