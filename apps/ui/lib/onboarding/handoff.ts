import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database, Json } from '@/app/api/database.types'
import { isKickoffText } from '@/lib/foreman/kickoff-marker'
import { installedArrival, type ForemanAnswers, type ForemanState } from '@/lib/foreman/phase'
import { readAnswers } from '@/lib/foreman/profile'
import { loadStarterPack } from '@/lib/foreman/starter-pack-offer'
import { walksTheDialog } from '@/lib/foreman/surface.server'

// What the Chief of Staff on the box knows when it takes over from the onboarding dialog.
export type ForemanHandoff = {
    // No team yet: set_up_team is in its brief.
    buildable: boolean
    // What a link installed before it said a word.
    arrival: { kind: 'template' | 'share'; title: string } | null
    // What they typed on the landing before signing up.
    prompt: string | null
    // The coworkers of the starter pack cards the app draws under its first message.
    pack: string[]
    pendingInvites: number
    inviteLinks: { email: string; link: string }[]
}

/**
 * The handoff, for a turn of an admin of a workspace the dialog walked: every turn until the first
 * team is built, and the turn that opens the conversation (an arrival's coworker is already there).
 */
export async function loadForemanHandoff(ctx: WorkspaceContext, state: ForemanState, text: string): Promise<ForemanHandoff | null> {
    if (state.isMember || !walksTheDialog(state)) return null
    const { foreman } = state
    const buildable = !foreman.firstRunAt && state.agents.length === 0
    if (!buildable && !isKickoffText(text)) return null
    const installed = installedArrival(foreman)
    const pack = buildable && !installed ? ((await loadStarterPack(ctx, state).catch(() => null))?.cards.map(card => card.agent) ?? []) : []
    return {
        buildable,
        arrival: installed ? { kind: installed.kind, title: installed.title } : null,
        prompt: foreman.arrival?.kind === 'prompt' ? foreman.arrival.ref : null,
        pack,
        pendingInvites: foreman.pendingInvites?.length ?? 0,
        inviteLinks: foreman.inviteLinks ?? [],
    }
}

/**
 * Takes the opening of the Chief of Staff's first conversation, once per workspace: the General
 * conversation is each member's own, and a second admin must not get a second welcome. `false` when
 * someone else already opened it.
 */
export async function claimOnboardingHandoff(ctx: WorkspaceContext): Promise<boolean> {
    const answers: ForemanAnswers = await readAnswers(ctx)
    if (answers.foreman?.handoffAt) return false
    const next: ForemanAnswers = { ...answers, foreman: { ...answers.foreman, handoffAt: new Date().toISOString() } }
    const { data, error } = await ctx.supabase
        .from('workspace_onboarding')
        .update<Database['public']['Tables']['workspace_onboarding']['Update']>({ answers: next as unknown as Json, updated_at: new Date().toISOString() })
        .eq('workspace_id', ctx.workspace.id)
        .filter('answers->foreman->>handoffAt', 'is', null)
        .select('workspace_id')
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0
}
