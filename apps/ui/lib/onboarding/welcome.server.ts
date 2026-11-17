import 'server-only'

import { cookies } from 'next/headers'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { foremanHubApiKey } from '@/lib/foreman/hub-api-key'
import type { ForemanAnswers } from '@/lib/foreman/phase'
import { readAnswers } from '@/lib/foreman/profile'
import { readFirstName } from '@/lib/naming/first-name'
import { BILLING_ENABLED, isLifetimePlan, isPaidSubscription, isSubscriptionEntitled } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { needsOnboarding, onboardingStep, type OnboardingStep } from './step'

export type WelcomeState = { needed: boolean; step: OnboardingStep; answers: ForemanAnswers; firstName: string | null }

export async function readWelcomeState(ctx: WorkspaceContext): Promise<WelcomeState> {
    const [answers, { data: agentCount }, { data: workspace }, cookieStore] = await Promise.all([
        readAnswers(ctx),
        selectCount(ctx.supabase, 'agents', { workspace_id: ctx.workspace.id }),
        selectMaybeSingle(ctx.supabase, 'workspaces', ['boxes_archived_at'] as const, { id: ctx.workspace.id }),
        cookies(),
    ])
    const status = ctx.workspace.subscription_status
    const needed = needsOnboarding({
        role: ctx.role,
        onboardedAt: ctx.workspace.onboarded_at,
        isSandbox: ctx.workspace.is_sandbox,
        archived: !!workspace?.boxes_archived_at,
        agentCount: agentCount ?? 0,
        paying: RERUN_CLOUD && (isPaidSubscription(status) || isLifetimePlan(ctx.workspace)),
        inHubFunnel: !!answers.foreman?.profileAt || !!answers.foreman?.plan,
        arrivingByInvite: cookieStore.has(PENDING_INVITE_COOKIE),
        hubForeman: RERUN_CLOUD || !!foremanHubApiKey(),
    })
    return {
        needed: needed && !ctx.authUser.is_anonymous,
        step: onboardingStep({ answers, entitled: isSubscriptionEntitled(status), billing: BILLING_ENABLED }),
        answers,
        firstName: readFirstName(ctx.authUser.user_metadata) || null,
    }
}
