// No 'server-only': the subscriber trial sweep reaches this from Trigger.dev.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AddonQuantities } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { notifyWorkspace } from './notify'
import { appDefinition } from './registry'
import { connectionsToPause, heldSlots } from './slots'
import { targetAppStatus } from './status'
import { APP_CONNECTION_COLUMNS, APP_SLUGS, SLOT_HOLDING_STATUSES, type AppSlug } from './types'

type Client = SupabaseClient<Database>
type WorkspaceAppInsert = Database['public']['Tables']['workspace_apps']['Insert']
type WorkspaceAppUpdate = Database['public']['Tables']['workspace_apps']['Update']
type ConnectionUpdate = Database['public']['Tables']['app_connections']['Update']

// Pauses this module puts on and takes off as slots come and go. A pause for a LinkedIn limit is
// not its business.
export const SLOT_PAUSE_REASONS = ['slots', 'trial_payment_failed'] as const

export function subscriberTrialOpen(app: { trial_ends_at: string | null; trial_settled_at: string | null } | null | undefined): boolean {
    return !!app?.trial_ends_at && !app.trial_settled_at
}

async function syncAppSlots(supabase: Client, workspaceId: number, slug: AppSlug, stripeSlots: number, periodAdvanced: boolean): Promise<void> {
    const { data: existing } = await selectMaybeSingle(supabase, 'workspace_apps', ['slots', 'trial_ends_at', 'trial_settled_at'] as const, { workspace_id: workspaceId, app_slug: slug })
    if (!existing && stripeSlots === 0) return

    const now = new Date().toISOString()
    if (!existing) {
        const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['boxes_archived_at', 'boxes_deleted_at'] as const, { id: workspaceId })
        const { error } = await supabase
            .from('workspace_apps')
            .insert<WorkspaceAppInsert>({ workspace_id: workspaceId, app_slug: slug, slots: stripeSlots, status: workspace ? targetAppStatus(workspace) : 'active' })
        if (error && error.code !== '23505') throw new Error(error.message)
    } else {
        const slots = heldSlots(existing.slots, stripeSlots, periodAdvanced)
        if (slots !== existing.slots) {
            const { error } = await supabase.from('workspace_apps').update<WorkspaceAppUpdate>({ slots, updated_at: now }).eq('workspace_id', workspaceId).eq('app_slug', slug)
            if (error) throw new Error(error.message)
        }
    }

    const allowed = stripeSlots + (subscriberTrialOpen(existing) ? 1 : 0)
    const { data: connections } = await selectMany(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { workspace_id: workspaceId, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] })
    const holding = connections ?? []

    // A slot bought back lifts the pause it had put on, oldest account first.
    const pausedForSlots = holding.filter(connection => connection.status === 'paused' && (SLOT_PAUSE_REASONS as readonly string[]).includes(connection.pause_reason ?? ''))
    const running = holding.length - pausedForSlots.length
    const toResume = [...pausedForSlots].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, Math.max(0, allowed - running))
    if (toResume.length > 0) {
        const { error } = await supabase
            .from('app_connections')
            .update<ConnectionUpdate>({ status: 'connected', pause_reason: null, paused_until: null, updated_at: now })
            .in('id', toResume.map(connection => connection.id))
        if (error) throw new Error(error.message)
    }

    // A slot given back lands at the renewal; whatever it no longer covers then is paused, never
    // deleted, so buying the slot again puts it straight back.
    if (!periodAdvanced) return
    const resumed = new Set(toResume.map(connection => connection.id))
    const occupying = holding.filter(connection => !pausedForSlots.includes(connection) || resumed.has(connection.id))
    const toPause = connectionsToPause(occupying, allowed)
    if (toPause.length === 0) return
    const { error } = await supabase.from('app_connections').update<ConnectionUpdate>({ status: 'paused', pause_reason: 'slots', paused_until: null, updated_at: now }).in('id', toPause)
    if (error) throw new Error(error.message)

    const app = appDefinition(slug)
    await notifyWorkspace(supabase, workspaceId, {
        appName: app.name,
        message: `Your plan now has ${stripeSlots} ${app.providerLabel} slot${stripeSlots === 1 ? '' : 's'}, so ${toPause.length} connected account${toPause.length === 1 ? ' is' : 's are'} paused. Add a slot in Billing to bring ${toPause.length === 1 ? 'it' : 'them'} back.`,
        copy: { key: 'slotsPaused', values: { slots: stripeSlots, provider: app.providerLabel, paused: toPause.length } },
        email: true,
    })
}

/**
 * Called by the Stripe webhook with the add-on quantities it just read off the subscription.
 * `periodAdvanced` is what lets a decrease land, exactly like the held limits of max_agents.
 */
export async function syncWorkspaceAppSlots(supabase: Client, workspaceId: number, quantities: AddonQuantities, { periodAdvanced }: { periodAdvanced: boolean }): Promise<void> {
    for (const slug of APP_SLUGS) {
        await syncAppSlots(supabase, workspaceId, slug, quantities[appDefinition(slug).addonKey], periodAdvanced)
    }
}
