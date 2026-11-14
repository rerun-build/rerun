import type Stripe from 'stripe'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type StripeEventInsert = Database['public']['Tables']['stripe_events']['Insert']
type StripeEventUpdate = Database['public']['Tables']['stripe_events']['Update']

const CLAIM_LEASE_MS = 5 * 60_000

export type StripeEventClaim = 'claimed' | 'processed' | 'in_flight'

export async function claimStripeEvent(event: Stripe.Event, now = new Date()): Promise<StripeEventClaim> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase
        .from('stripe_events')
        .insert<StripeEventInsert>({ id: event.id, type: event.type, connected_account_id: event.account ?? null, claimed_at: now.toISOString() })

    if (!error) return 'claimed'

    const { data } = await selectMaybeSingle(supabase, 'stripe_events', ['processed_at', 'claimed_at'] as const, { id: event.id })
    if (!data) return 'claimed'
    if (data.processed_at) return 'processed'
    if (now.getTime() - Date.parse(data.claimed_at) < CLAIM_LEASE_MS) return 'in_flight'

    const { data: takenOver } = await supabase
        .from('stripe_events')
        .update<StripeEventUpdate>({ claimed_at: now.toISOString() })
        .eq('id', event.id)
        .eq('claimed_at', data.claimed_at)
        .is('processed_at', null)
        .select('id')
    return takenOver?.length ? 'claimed' : 'in_flight'
}

export function unclaimedResponse(claim: Exclude<StripeEventClaim, 'claimed'>): Response {
    return claim === 'processed' ? Response.json({ received: true, duplicate: true }, { status: 200 }) : Response.json({ error: 'Event already being processed' }, { status: 409 })
}

export async function markStripeEventProcessed(eventId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('stripe_events').update<StripeEventUpdate>({ processed_at: new Date().toISOString() }).eq('id', eventId)
}

export async function releaseStripeEvent(eventId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('stripe_events').delete().eq('id', eventId)
}
