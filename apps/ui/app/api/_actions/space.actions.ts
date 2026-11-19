'use server'

import { AppError, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import { assertAdminUser } from '@/lib/auth/admin'
import { actorFromContext, requireLightSessionActor } from '@/app/api/_auth/access'
import { requireWorkspaceContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import { createBox, deleteBox, renameBox } from '@/app/api/_services/box.service'
import { findWorkspaceEngine, NoEngineError } from '@/app/api/_services/workspace-engine.service'
import { restartManagedEngine } from '@moldwright/cloud/engines'
import type { SpaceSide } from '@/lib/board/space-layout'

export type ActionResult<T = unknown> = ({ ok: true } & T) | ActionFailure

export async function claimSpaceAction(params: { workspaceId: number; name?: string | null; from?: { spaceId: string; side: SpaceSide } }): Promise<ActionResult<{ spaceId: string; colStart: number; rowStart: number }>> {
    try {
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

async function managedInstanceId(): Promise<string> {
    await assertAdminUser()
    const engine = await findWorkspaceEngine(await requireWorkspaceId())
    if (!engine) throw new NoEngineError()
    if (!engine.managed) throw new AppError('engineNotManaged')
    return engine.instanceId
}

export async function restartWorkspaceEngineAction(): Promise<ActionResult> {
    try {
        await restartManagedEngine(await managedInstanceId())
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'restartMachineFailed')
    }
}
