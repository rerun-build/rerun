'use server'

import { actorFromContext, isAdminActor } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { mergeForeman, readAnswers } from '@/lib/foreman/profile'
import { onboardingReleasedAt } from '@/lib/onboarding/facts'
import { ONBOARDING_INVITES_MAX } from '@/lib/onboarding/invites'
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The invitation step of the dialog, sent or skipped: the addresses wait in the onboarding answers
 * and leave once the team is built (lib/onboarding/invites.ts). An empty list skips the step.
 */
export async function saveOnboardingInvitesAction(emails: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx))) return { ok: false, error: 'Only an admin can invite people.' }
    const kept = [...new Set(emails.map(email => email.trim().toLowerCase()))].filter(email => EMAIL_RE.test(email))
    if (kept.length > ONBOARDING_INVITES_MAX) return { ok: false, error: `At most ${ONBOARDING_INVITES_MAX} addresses.` }
    const own = ctx.userEmail?.toLowerCase()
    const pendingInvites = kept.filter(email => email !== own).map(email => ({ email, invitedBy: ctx.userId }))
    await mergeForeman(ctx, { pendingInvites, inviteAt: new Date().toISOString() })
    return { ok: true }
}
