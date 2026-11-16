import 'server-only'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { buildTeamOnce } from '@/lib/foreman/build-once'
import type { KickoffIntent } from '@/lib/foreman/kickoff-marker'
import { writePlan } from '@/lib/foreman/onboarding-tools'
import type { ForemanProfile } from '@/lib/foreman/phase'
import { mergeForeman, readAnswers } from '@/lib/foreman/profile'
import { planKinds } from '@/lib/foreman/phases'
import { readyMadePlanOf } from '@/lib/foreman/scripted'
import { loadForemanState } from '@/lib/foreman/state'
import { owedTemplatePurchase } from '@/lib/foreman/template-purchase'

export type InstallArrivalOutcome = { status: 'installed' } | { status: 'purchase'; slug: string; title: string } | { status: 'unavailable' } | { status: 'failed'; error: string }

// The link: written down at the first signed-in page, or, for a workspace that met the hub's
// onboarding on it, the plan that onboarding already wrote.
function linkOf(foreman: ForemanProfile): KickoffIntent | null {
    const arrival = foreman.arrival
    if (arrival?.kind === 'template') return { kind: 'template', slug: arrival.ref }
    if (arrival?.kind === 'share') return { kind: 'share', token: arrival.ref }
    const [item] = foreman.installedFirst ? (foreman.plan?.items ?? []) : []
    if (item?.kind === 'template') return { kind: 'template', slug: item.slug }
    if (item?.kind === 'share') return { kind: 'share', token: item.token }
    return null
}

// What the link a workspace arrived on installs, once its box is there: the plan the hub's onboarding
// wrote for the same link, then the same build (one per workspace, `firstRunAt` written at its end).
// A template still to be bought comes back to be bought first. A link that no longer resolves is
// given up: the workspace answers the welcome questions instead.
export async function installArrival(ctx: WorkspaceContext): Promise<InstallArrivalOutcome> {
    const { foreman = {} } = await readAnswers(ctx)
    const intent = linkOf(foreman)
    if (!intent) return { status: 'unavailable' }
    const load = () => loadForemanState(ctx, null, intent)

    let state = await load()
    if (!state.foreman.plan) {
        const ready = readyMadePlanOf(state)
        if (!ready) {
            await mergeForeman(ctx, { arrival: undefined })
            return { status: 'unavailable' }
        }
        await writePlan(ctx, { ...ready.shown, title: state.answers.company_name ?? state.workspaceName }, planKinds(state), null, !state.foreman.profileAt)
        state = await load()
    }

    const purchase = await owedTemplatePurchase(ctx, state.foreman.plan)
    if (purchase) return { status: 'purchase', slug: purchase.slug, title: purchase.title }

    try {
        const result = await buildTeamOnce({ ctx, state, emit: () => {}, reload: load })
        return result.agents.length ? { status: 'installed' } : { status: 'failed', error: result.failed[0]?.error ?? 'Nothing could be installed.' }
    } catch (err) {
        return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
}
