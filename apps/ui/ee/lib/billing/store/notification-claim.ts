import 'server-only'

import type { Database, Json } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { StoreProvider } from '@rerun/contracts'

// The store notifications are handled once, the way stripe_events handles Stripe's (see the Stripe
// webhook's idempotency.ts): the row is claimed before the handler runs and stamped once it
// succeeded. A redelivery of a handled notification is dropped, the retry of one whose handler
// crashed runs again, and a second delivery arriving while the first still runs is answered 409 so
// the store tries it later. Past the lease, one delivery takes the claim over.
//
// The readings are full-state updates, so a replay would converge anyway; the claim is what keeps
// a replay from reporting a transition twice and from writing an older state over a newer one.

type StoreNotificationInsert = Database['public']['Tables']['store_notifications']['Insert']
type StoreNotificationUpdate = Database['public']['Tables']['store_notifications']['Update']

const CLAIM_LEASE_MS = 5 * 60_000

export type StoreNotificationClaim = 'claimed' | 'processed' | 'in_flight'

export type StoreNotificationKey = { provider: StoreProvider; notificationId: string }

export async function claimStoreNotification({ provider, notificationId }: StoreNotificationKey, type: string, payload: Json, now = new Date()): Promise<StoreNotificationClaim> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase
        .from('store_notifications')
        .insert<StoreNotificationInsert>({ provider, notification_id: notificationId, type, payload, claimed_at: now.toISOString() })
    if (!error) return 'claimed'

    const { data } = await selectMaybeSingle(supabase, 'store_notifications', ['processed_at', 'claimed_at'] as const, { provider, notification_id: notificationId })
    // No row at all means the insert failed for another reason: running the handler is safer than
    // dropping a real notification.
    if (!data) return 'claimed'
    if (data.processed_at) return 'processed'
    if (now.getTime() - Date.parse(data.claimed_at) < CLAIM_LEASE_MS) return 'in_flight'

    const { data: takenOver } = await supabase
        .from('store_notifications')
        .update<StoreNotificationUpdate>({ claimed_at: now.toISOString() })
        .eq('provider', provider)
        .eq('notification_id', notificationId)
        .eq('claimed_at', data.claimed_at)
        .is('processed_at', null)
        .select('notification_id')
    return takenOver?.length ? 'claimed' : 'in_flight'
}

export function unclaimedStoreResponse(claim: Exclude<StoreNotificationClaim, 'claimed'>): Response {
    return claim === 'processed' ? Response.json({ received: true, duplicate: true }, { status: 200 }) : Response.json({ error: 'Notification already being processed' }, { status: 409 })
}

export async function markStoreNotificationProcessed({ provider, notificationId }: StoreNotificationKey): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase
        .from('store_notifications')
        .update<StoreNotificationUpdate>({ processed_at: new Date().toISOString() })
        .eq('provider', provider)
        .eq('notification_id', notificationId)
}

// A handler that threw leaves no claim behind, or the store's retry would be dropped as a duplicate.
export async function releaseStoreNotification({ provider, notificationId }: StoreNotificationKey): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('store_notifications').delete().eq('provider', provider).eq('notification_id', notificationId)
}
