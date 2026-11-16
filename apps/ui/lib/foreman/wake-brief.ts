import 'server-only'

import type { ForemanWakeBrief, ForemanWakeRequest, ForemanWakeSkipReason } from '@rerun/contracts'

import { memberActor, visibleSpaceIds } from '@/app/api/_auth/access'
import { memberWorkspaceContext, workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { foremanWakeTools } from './engine-brief'
import { mintForemanWakeToken } from './hub-token'
import { foremanWakeInstructions } from './prompt'
import { loadForemanState } from './state'

// The switch for everyone, once the internal wave went well. Until then, the workspaces listed in
// FOREMAN_WAKE_WORKSPACES (ids, comma separated) are the only ones that wake. A flag would not do:
// flags are read from a browser's session, and nobody's browser is behind a box asking.
const FOREMAN_WAKES_RELEASED = false

// A CLI that brings tools of its own Rerun cannot switch off. Codex keeps `apply_patch` whatever the
// run is given, so a wake on it could write; it stays asleep until its sandbox is proven on a box.
const HELD_PROVIDERS = new Set(['codex'])

const DAY_MS = 24 * 60 * 60 * 1000
// A workspace nobody opened for a week gets one wake a week, not one a day.
const DORMANT_AFTER_MS = 7 * DAY_MS

export function wakesOpenTo(workspaceId: number): boolean {
    if (FOREMAN_WAKES_RELEASED) return true
    return (process.env.FOREMAN_WAKE_WORKSPACES ?? '')
        .split(',')
        .map(id => id.trim())
        .includes(String(workspaceId))
}

const skip = (reason: ForemanWakeSkipReason): ForemanWakeBrief => ({ skip: reason })

// The box cannot tell Boxes apart: a wake reads every coworker's runs and files. So it only speaks to
// someone who sees every Box, the member the signal concerns when they do, the founder otherwise.
async function memberToWake(workspaceId: number, requested: string | null | undefined): Promise<string | null> {
    if (requested) {
        const actor = await memberActor(workspaceId, requested)
        if (actor && (await visibleSpaceIds(actor)) === 'all') return requested
    }
    return workspaceFounderUserId(workspaceId)
}

async function lastHumanActivity(workspaceId: number): Promise<number | null> {
    const supabase = createServiceRoleClient()
    const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId })
    const ids = (members ?? []).map(member => member.user_id)
    if (!ids.length) return null
    const { data: users } = await selectMany(supabase, 'users', ['last_active_at'] as const, { id: ids })
    const times = (users ?? []).flatMap(user => (user.last_active_at ? [Date.parse(user.last_active_at)] : []))
    return times.length ? Math.max(...times) : null
}

export function isDormant(lastActivity: number | null, lastWakeAt: string | null | undefined, now: number): boolean {
    if (lastActivity !== null && now - lastActivity < DORMANT_AFTER_MS) return false
    const lastWake = lastWakeAt ? Date.parse(lastWakeAt) : NaN
    return Number.isFinite(lastWake) && now - lastWake < DORMANT_AFTER_MS
}

export async function foremanWakeBrief(workspaceId: number, request: ForemanWakeRequest, now = Date.now()): Promise<ForemanWakeBrief> {
    if (!process.env.FOREMAN_HUB_TOKEN_SECRET) return skip('no_token_secret')
    const { data: workspace } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['is_sandbox', 'subscription_status', 'assistant_proactive'] as const, { id: workspaceId })
    if (!workspace || workspace.is_sandbox) return skip('sandbox')
    if (!workspace.assistant_proactive) return skip('disabled')
    if (!wakesOpenTo(workspaceId)) return skip('not_released')
    if (!isSubscriptionEntitled(workspace.subscription_status)) return skip('no_plan')
    if (request.provider && HELD_PROVIDERS.has(request.provider)) return skip('provider')
    if (isDormant(await lastHumanActivity(workspaceId), request.lastWakeAt, now)) return skip('dormant')

    const memberId = await memberToWake(workspaceId, request.memberId)
    const ctx = memberId ? await memberWorkspaceContext(workspaceId, memberId) : null
    if (!memberId || !ctx) return skip('no_member')

    const [state, { data: user }] = await Promise.all([loadForemanState(ctx, null), selectMaybeSingle(ctx.supabase, 'users', ['timezone'] as const, { id: memberId })])
    const hubToken = mintForemanWakeToken(workspaceId, memberId, now)
    if (!hubToken) return skip('no_token_secret')
    return {
        brief: { instructions: foremanWakeInstructions(state), tools: foremanWakeTools(), builtins: ['schedule_wake'], hubToken },
        memberId,
        timezone: user?.timezone ?? null,
    }
}
