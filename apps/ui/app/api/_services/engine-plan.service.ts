import { isPremiumModel, modelLabel } from '@rerun/contracts'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { isPremiumModelEntitled } from '@rerun/cloud/billing'
import { setBoxPlan } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { AppError } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

async function premiumModelsAllowed(workspaceId: number): Promise<boolean> {
    const { data: workspace } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['subscription_status', 'is_sandbox'] as const, { id: workspaceId })
    return !!workspace && isPremiumModelEntitled(workspace)
}

export async function pushBoxPlan(workspaceId: number, conn: EngineConnection): Promise<void> {
    try {
        await setBoxPlan(conn, { premiumModels: await premiumModelsAllowed(workspaceId) })
    } catch (err) {
        console.error(`[plan] failed to push the plan of workspace ${workspaceId}`, err)
    }
}

export class ModelNotEntitledError extends AppError {
    constructor(model: string) {
        super('modelNeedsPaidPlan', { model: modelLabel(model) })
        this.name = 'ModelNotEntitledError'
    }
}

export async function assertModelEntitled(model: string | null | undefined, workspaceId?: number): Promise<void> {
    if (!model || !isPremiumModel(model)) return
    if (await premiumModelsAllowed(workspaceId ?? (await requireWorkspaceId()))) return
    throw new ModelNotEntitledError(model)
}
