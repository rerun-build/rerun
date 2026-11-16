'use server'

import { actorFromContext, isAdminActor } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { mergeForeman, readAnswers } from '@/lib/foreman/profile'
import { onboardingReleasedAt } from '@/lib/onboarding/facts'
import { isLegacyWorkspace } from '@/lib/onboarding/step'

const REF_MAX = 2000
const ARRIVAL_KINDS = ['template', 'share', 'prompt'] as const
type ArrivalKind = (typeof ARRIVAL_KINDS)[number]

/**
 * Writes down the link a new workspace arrived on, once: a template or a shared coworker skips the
 * questions and is installed once the box is there, a prompt is carried to the Chief of Staff. An
 * account that already answered, or a workspace already running, opens the link the usual way.
 */
export async function recordOnboardingArrivalAction(kind: ArrivalKind, ref: string): Promise<void> {
    if (!ARRIVAL_KINDS.includes(kind)) return
    const trimmed = ref.trim().slice(0, REF_MAX)
    if (!trimmed) return
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx)) || ctx.workspace.onboarded_at || ctx.workspace.is_sandbox) return
    const { foreman = {} } = await readAnswers(ctx)
    if (foreman.arrival || foreman.profileAt || foreman.plan) return
    if (isLegacyWorkspace({ createdAt: ctx.workspace.created_at ?? null, onboardedAt: null, foreman }, onboardingReleasedAt())) return
    await mergeForeman(ctx, { arrival: { kind, ref: trimmed, at: new Date().toISOString() } })
}
