import 'server-only'

import { isAdminActor, actorFromContext } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { poolHasRoom } from '@rerun/cloud/engines'
import { isPhoneStepPending } from '@rerun/cloud/phone.server'
import type { OnboardingFacts } from './step'

// Workspaces created before the onboarding dialog shipped keep the hub's onboarding (step.ts,
// isLegacyWorkspace).
export const ONBOARDING_DIALOG_RELEASED_AT = '2026-11-16T00:00:00Z'

function readAnswers(value: unknown): ForemanAnswers {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ForemanAnswers) : {}
}

export async function loadOnboardingFacts(ctx: WorkspaceContext): Promise<OnboardingFacts> {
    const supabase = createServiceRoleClient()
    const workspaceId = ctx.workspace.id
    const [{ data: onboarding }, { data: workspace }, { data: agentCount }, engine, phonePending] = await Promise.all([
        selectMaybeSingle(supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: workspaceId }),
        selectMaybeSingle(supabase, 'workspaces', ['boxes_archived_at'] as const, { id: workspaceId }),
        selectCount(supabase, 'agents', { workspace_id: workspaceId }),
        findWorkspaceEngine(workspaceId),
        isPhoneStepPending(ctx.supabase, ctx.userId),
    ])
    const entitled = isSubscriptionEntitled(ctx.workspace.subscription_status)
    const hasEngine = !!engine
    return {
        admin: isAdminActor(actorFromContext(ctx)),
        sandbox: !!ctx.workspace.is_sandbox,
        createdAt: ctx.workspace.created_at ?? null,
        archived: !!workspace?.boxes_archived_at,
        onboardedAt: ctx.workspace.onboarded_at ?? null,
        foreman: readAnswers(onboarding?.answers).foreman ?? {},
        agentCount: agentCount ?? 0,
        phonePending,
        entitled,
        hasEngine,
        // The pool is only asked when it can change the step.
        poolHasRoom: RERUN_CLOUD && !entitled && !hasEngine ? await poolHasRoom() : true,
        cloud: RERUN_CLOUD,
    }
}
