import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { reportWorkspaceEvent } from '@/lib/apps/analytics'
import { summarizeAttachments } from '@/lib/apps/attachments'
import { claimQuota, connectionScope, markNeedsReconnect } from '@/lib/apps/connections'
import type { LinkupEnvelope } from '@/lib/apps/linkup/envelope'
import { DAILY_WAKE_LIMIT, dayKey } from '@/lib/apps/quotas'
import { appDefinition } from '@/lib/apps/registry'
import { isAppSlug, type AppSlug } from '@/lib/apps/types'
import { fireTrigger } from '@/lib/engine/client'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type ConnectionUpdate = Database['public']['Tables']['app_connections']['Update']
type WebhookEventInsert = Database['public']['Tables']['app_webhook_events']['Insert']
type WebhookEventUpdate = Database['public']['Tables']['app_webhook_events']['Update']

// Linkup gives up on a delivery after 10 seconds, and every coworker is woken in parallel within it.
// The voice notes of the message are transcribed first, in a share of that time: past it the coworker
// wakes without the words rather than not at all.
const FIRE_TIMEOUT_MS = 8_000
const TRANSCRIBE_BUDGET_MS = 4_000
const MIN_FIRE_TIMEOUT_MS = 2_000

export type InboundConnection = { id: string; workspace_id: number; app_slug: AppSlug; label: string | null; provider_member_id: string | null; status: string; provider_webhook_secret: string | null }

// Linkup's account ids are unique across its platforms, so the account alone names the app.
export async function connectionForAccount(supabase: Client, accountId: string): Promise<InboundConnection | null> {
    const { data } = await selectMany(supabase, 'app_connections', ['id', 'workspace_id', 'app_slug', 'label', 'provider_member_id', 'status', 'provider_webhook_secret'] as const, { provider_account_id: accountId, status: { neq: 'deleted' } }, { column: 'created_at', ascending: false }, 1)
    const row = data?.[0]
    if (!row || !isAppSlug(row.app_slug)) return null
    return { ...row, app_slug: row.app_slug }
}

// Claimed before the handler runs and stamped after it succeeds, like stripe_events: a duplicate of
// a processed delivery is dropped, a retry of one whose handler crashed runs again.
export async function claimDelivery(supabase: Client, eventId: string, slug: AppSlug): Promise<boolean> {
    const { error } = await supabase.from('app_webhook_events').insert<WebhookEventInsert>({ event_id: eventId, app_slug: slug })
    if (!error) return true
    const { data } = await selectMaybeSingle(supabase, 'app_webhook_events', ['processed_at'] as const, { event_id: eventId })
    return !data?.processed_at
}

export async function markDeliveryProcessed(supabase: Client, eventId: string): Promise<void> {
    await supabase.from('app_webhook_events').update<WebhookEventUpdate>({ processed_at: new Date().toISOString() }).eq('event_id', eventId)
}

export async function releaseDelivery(supabase: Client, eventId: string): Promise<void> {
    await supabase.from('app_webhook_events').delete().eq('event_id', eventId)
}

async function wakeSubscribers(supabase: Client, connection: InboundConnection, event: string, envelope: LinkupEnvelope): Promise<number> {
    const startedAt = Date.now()
    const { data: app } = await selectMaybeSingle(supabase, 'workspace_apps', ['status'] as const, { workspace_id: connection.workspace_id, app_slug: connection.app_slug })
    if (app?.status !== 'active' || connection.status !== 'connected') return 0

    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id', 'wake_on_events', 'trigger_slug', 'trigger_token'] as const, { connection_id: connection.id })
    const subscribers = (bindings ?? []).filter(binding => binding.wake_on_events.includes(event) && binding.trigger_slug && binding.trigger_token)
    if (subscribers.length === 0) return 0

    const { data: agents } = await selectMany(supabase, 'agents', ['id', 'engine_agent_id', 'disabled_at'] as const, { id: subscribers.map(binding => binding.agent_id) })
    const agentById = new Map((agents ?? []).map(agent => [agent.id, agent]))
    const conn = await getWorkspaceConnection(connection.workspace_id)
    const definition = appDefinition(connection.app_slug)
    const attachments = await summarizeAttachments({
        accountId: envelope.account_id,
        connectionId: connection.id,
        attachments: envelope.event.attachments ?? [],
        base: definition.attachmentBase(envelope),
        budgetMs: TRANSCRIBE_BUDGET_MS,
    })
    const body = JSON.stringify(definition.wakePayload(event, envelope, { label: connection.label, id: connection.provider_member_id }, attachments))
    const fireTimeoutMs = Math.max(MIN_FIRE_TIMEOUT_MS, FIRE_TIMEOUT_MS - (Date.now() - startedAt))
    const day = dayKey(new Date())

    const fired = await Promise.all(
        subscribers.map(async binding => {
            const agent = agentById.get(binding.agent_id)
            if (!agent?.engine_agent_id || agent.disabled_at) return false
            if (!(await claimQuota(supabase, connectionScope(connection.id), 'wake', [day], [DAILY_WAKE_LIMIT]))) return false
            const outcome = await fireTrigger(
                conn,
                agent.engine_agent_id,
                binding.trigger_slug as string,
                { token: binding.trigger_token as string, method: 'POST', query: '', contentType: 'application/json', body, bodyBytes: Buffer.byteLength(body, 'utf8') },
                AbortSignal.timeout(fireTimeoutMs),
            ).catch(err => {
                console.warn(`[apps:${connection.app_slug}] could not wake agent ${binding.agent_id}`, err instanceof Error ? err.message : err)
                return null
            })
            return outcome?.status === 202
        }),
    )
    return fired.filter(Boolean).length
}

// Handles one verified, deduplicated delivery. Throws only on what a retry could fix.
export async function handleLinkupEnvelope(supabase: Client, connection: InboundConnection, envelope: LinkupEnvelope): Promise<void> {
    const kind = appDefinition(connection.app_slug).envelopeKind(envelope)
    if (kind.kind === 'ignored') return

    if (kind.kind === 'disconnection') {
        if (connection.status === 'connected' || connection.status === 'paused') await markNeedsReconnect(supabase, connection, connection.app_slug, 'disconnected')
        return
    }

    // Not through updateConnection: updated_at is what the reconciliation measures an unpaid pause
    // from, and a busy inbox must not keep resetting it.
    if (connection.status === 'connected') {
        const { error } = await supabase.from('app_connections').update<ConnectionUpdate>({ last_event_at: new Date().toISOString() }).eq('id', connection.id)
        if (error) throw new Error(error.message)
    }
    const woken = await wakeSubscribers(supabase, connection, kind.event, envelope)
    await reportWorkspaceEvent(supabase, connection.workspace_id, 'app_event_fired', { app: connection.app_slug, event: kind.event, woken })
}
