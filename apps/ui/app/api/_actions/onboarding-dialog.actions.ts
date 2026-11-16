'use server'

import { actorFromContext, isAdminActor } from '@/app/api/_auth/access'
import { ensureWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { installArrival, type InstallArrivalOutcome } from '@/lib/onboarding/install-arrival'
import { claimOnboardingHandoff } from '@/lib/onboarding/handoff'
import { loadForemanState } from '@/lib/foreman/state'
import type { StarterPackInput } from '@/lib/foreman/starter-pack'
import { loadStarterPack } from '@/lib/foreman/starter-pack-offer'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { mergeForeman, readAnswers } from '@/lib/foreman/profile'
import { ONBOARDING_DIALOG_RELEASED_AT } from '@/lib/onboarding/facts'
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
    if (isLegacyWorkspace({ createdAt: ctx.workspace.created_at ?? null, onboardedAt: null, foreman }, ONBOARDING_DIALOG_RELEASED_AT)) return
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

export type ClaimOutcome = { status: 'claimed' } | { status: 'no_machine' } | { status: 'no_server' } | { status: 'refused' }

/**
 * Takes the workspace's box once its plan is on: from the pool on Rerun Cloud, the compose engine on
 * a self-hosted install. An empty pool is waited out, asked again by the step; a second self-hosted
 * workspace has no engine of its own to take.
 */
export async function claimOnboardingEngineAction(): Promise<ClaimOutcome> {
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx)) || !isSubscriptionEntitled(ctx.workspace.subscription_status)) return { status: 'refused' }
    const claimed = await ensureWorkspaceEngine(ctx.workspace.id).catch(err => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (claimed.ok) return { status: 'claimed' }
    if (!RERUN_CLOUD) return { status: 'no_server' }
    console.error(`[onboarding] no machine for workspace ${ctx.workspace.id}, which is on its plan:`, claimed.error)
    return { status: 'no_machine' }
}

/** Installs the template or the shared coworker the workspace arrived on, once its box is there. */
export async function installOnboardingArrivalAction(): Promise<InstallArrivalOutcome> {
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx))) return { status: 'failed', error: 'Only an admin can install.' }
    return installArrival(ctx)
}

/** Opens the Chief of Staff's first conversation, once per workspace: `true` for the one who opens it. */
export async function openOnboardingHandoffAction(): Promise<boolean> {
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx))) return false
    return claimOnboardingHandoff(ctx)
}

/** The starter pack drawn under the Chief of Staff's first message, while the workspace has no team. */
export async function loadOnboardingStarterPackAction(): Promise<StarterPackInput | null> {
    const ctx = await requireWorkspaceContext()
    if (!isAdminActor(actorFromContext(ctx))) return null
    const state = await loadForemanState(ctx, null)
    if (state.foreman.firstRunAt || state.agents.length > 0 || state.foreman.arrival?.kind === 'template' || state.foreman.arrival?.kind === 'share') return null
    return loadStarterPack(ctx, state)
}
