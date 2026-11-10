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

// Opus, Fable and Astra run on the user's own credentials, straight from the box to the provider,
// so the hub cannot step them down in flight the way it does Smart: the box has to know the plan.
// Best-effort: a box asleep or updating gets it again on its next update, and an engine older than
// plans answers 404 and keeps running everything.
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

// The box would step the model down anyway. Refusing the pin is what keeps a schedule from
// promising Opus and quietly running Sonnet. `workspaceId` is passed in when the caller proved its
// identity with an API key; omitted, it comes from the session.
export async function assertModelEntitled(model: string | null | undefined, workspaceId?: number): Promise<void> {
    if (!model || !isPremiumModel(model)) return
    if (await premiumModelsAllowed(workspaceId ?? (await requireWorkspaceId()))) return
    throw new ModelNotEntitledError(model)
}
