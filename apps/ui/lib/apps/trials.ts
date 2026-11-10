// No 'server-only': swept hourly from Trigger.dev.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { stripe } from '@/ee/lib/billing/stripe'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { reportWorkspaceEvent } from './analytics'
import { updateConnection } from './connections'
import { notifyWorkspace } from './notify'
import { appDefinition } from './registry'
import { addPaidSlot, slotQuantity } from './stripe-slots'
import { APP_CONNECTION_COLUMNS, SLOT_HOLDING_STATUSES, isAppSlug, type AppSlug } from './types'

type Client = SupabaseClient<Database>
type WorkspaceAppUpdate = Database['public']['Tables']['workspace_apps']['Update']

export const TRIAL_REMINDER_LEAD_MS = 2 * 86_400_000

export type TrialStep = 'remind' | 'convert' | null

export function trialStep(app: { trial_ends_at: string | null; trial_settled_at: string | null; trial_reminder_sent_at: string | null }, now: Date): TrialStep {
    if (!app.trial_ends_at || app.trial_settled_at) return null
    const endsAt = new Date(app.trial_ends_at).getTime()
    if (now.getTime() >= endsAt) return 'convert'
    if (!app.trial_reminder_sent_at && now.getTime() >= endsAt - TRIAL_REMINDER_LEAD_MS) return 'remind'
    return null
}

function dateLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

async function settle(supabase: Client, workspaceId: number, slug: AppSlug, update: WorkspaceAppUpdate): Promise<void> {
    const { error } = await supabase
        .from('workspace_apps')
        .update<WorkspaceAppUpdate>({ ...update, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

// A charge Stripe refused for the card itself, as opposed to Stripe being unreachable: only the first
// is the customer's answer, the second is retried on the next tick.
function isPaymentRefusal(err: unknown): boolean {
    const type = (err as { type?: string } | null)?.type
    return type === 'StripeCardError' || (err as { code?: string } | null)?.code === 'subscription_payment_intent_requires_action'
}

// Settled before Stripe is called: a crash between the two must not charge the slot twice on the
// next tick. The idempotency key covers a retry of the very same call, and an error that is not a
// refusal unsettles the trial so the next tick tries again.
async function convert(supabase: Client, workspaceId: number, slug: AppSlug): Promise<'charged' | 'nothing_to_charge' | 'declined'> {
    const app = appDefinition(slug)
    await settle(supabase, workspaceId, slug, { trial_settled_at: new Date().toISOString() })

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_subscription_id'] as const, { id: workspaceId })
    const { data: connections } = await selectMany(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { workspace_id: workspaceId, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] })
    const holding = connections ?? []
    const subscription = workspace?.stripe_subscription_id ? await stripe.subscriptions.retrieve(workspace.stripe_subscription_id) : null
    const paidSlots = subscription ? slotQuantity(subscription, app.addonKey) : 0
    // Disconnected during the trial: the user said no, and nothing is charged.
    if (holding.length <= paidSlots) return 'nothing_to_charge'

    const newest = [...holding].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    const pauseNewest = async (message: string, key: 'trialEndedPlanInactive' | 'trialEndedDeclined') => {
        if (newest) await updateConnection(supabase, newest.id, { status: 'paused', pause_reason: 'trial_payment_failed', paused_until: null })
        await notifyWorkspace(supabase, workspaceId, { appName: app.name, message, email: true, copy: { key, values: { provider: app.providerLabel, account: newest?.label ?? 'none' } } })
    }
    const account = newest?.label ?? 'the account'

    if (!subscription || subscription.status !== 'active') {
        await pauseNewest(`Your free ${app.providerLabel} slot ended while your plan is not active, so ${account} is paused. Add a slot in Billing within a week to keep it, or it will be disconnected.`, 'trialEndedPlanInactive')
        return 'declined'
    }
    try {
        await addPaidSlot(subscription, app.addonKey, `trial-convert-${workspaceId}-${slug}`)
        return 'charged'
    } catch (err) {
        if (!isPaymentRefusal(err)) {
            await settle(supabase, workspaceId, slug, { trial_settled_at: null })
            throw err
        }
        console.warn(`[apps:${slug}] trial conversion of workspace ${workspaceId} declined`, err instanceof Error ? err.message : err)
        await pauseNewest(`Your free ${app.providerLabel} slot ended and the card was declined, so ${account} is paused. Add a slot in Billing within a week to keep it, or it will be disconnected.`, 'trialEndedDeclined')
        return 'declined'
    }
}

export async function sweepSubscriberTrials(supabase: Client, now: Date): Promise<{ reminded: number; charged: number; declined: number; free: number; failed: string[] }> {
    const { data: apps } = await selectMany(supabase, 'workspace_apps', ['workspace_id', 'app_slug', 'trial_ends_at', 'trial_settled_at', 'trial_reminder_sent_at', 'status'] as const, { trial_ends_at: { notNull: true }, trial_settled_at: { isNull: true } })
    const report = { reminded: 0, charged: 0, declined: 0, free: 0, failed: [] as string[] }

    for (const row of apps ?? []) {
        if (!isAppSlug(row.app_slug)) continue
        const step = trialStep(row, now)
        try {
            if (step === 'remind' && row.status === 'active') {
                const app = appDefinition(row.app_slug)
                await notifyWorkspace(supabase, row.workspace_id, {
                    appName: app.name,
                    message: `Your free ${app.providerLabel} slot ends on ${dateLabel(row.trial_ends_at as string)}. It then becomes a paid slot on your plan. Disconnect the account from Settings → Apps before then if you do not want to keep it.`,
                    copy: { key: 'trialEndsSoon', values: { provider: app.providerLabel, endsAt: row.trial_ends_at as string } },
                    email: true,
                })
                await settle(supabase, row.workspace_id, row.app_slug, { trial_reminder_sent_at: now.toISOString() })
                report.reminded++
            }
            if (step === 'convert' && row.status !== 'active') {
                // A paused or removed workspace has no account left to bill: its trial simply ends.
                await settle(supabase, row.workspace_id, row.app_slug, { trial_settled_at: now.toISOString() })
                report.free++
            } else if (step === 'convert') {
                const outcome = await convert(supabase, row.workspace_id, row.app_slug)
                await reportWorkspaceEvent(supabase, row.workspace_id, 'app_trial_converted', { app: row.app_slug, outcome })
                if (outcome === 'charged') report.charged++
                if (outcome === 'declined') report.declined++
                if (outcome === 'nothing_to_charge') report.free++
            }
        } catch (err) {
            report.failed.push(`${row.workspace_id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    return report
}
