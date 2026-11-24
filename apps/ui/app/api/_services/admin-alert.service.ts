import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import type { Locale } from '@rerun/i18n'

import type { Database } from '@/app/api/database.types'
import { brandAppUrl } from '@/lib/brand/urls'
import type { SendEmailResult } from '@/lib/email/client'
import { loadEmailRecipient } from '@/lib/email/recipient'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribeToken'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { isPresent } from '@/lib/notifications/presence'
import { selectMany } from '@/supabase/supabase-helpers'

import { loadPresence } from './presence.service'

type Client = SupabaseClient<Database>
type IncidentUpdate = Database['public']['Tables']['notification_incidents']['Update']

export type AdminAlert = {
    workspaceId: number
    /** What stopped the coworkers. One email per admin for it, until `resolveAlert` closes it. */
    key: string
    /** Leaves alone the admins who have the app open: they see it there. */
    awayOnly?: boolean
    /** Reopens an alert nobody closed for that long, in case what should have closed it was lost. */
    reopenAfterMs?: number
    /** The brand of the workspace, which its emails wear. */
    brand?: Brand
}

/** The admins this alert still has to reach. An alert is about the account, not about one run: the Email switch does not decide. */
export async function adminsToAlert(supabase: Client, { workspaceId, key, awayOnly, reopenAfterMs }: AdminAlert, now: Date = new Date()): Promise<string[]> {
    const { data: admins } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, role: 'admin' })
    const adminIds = (admins ?? []).map(admin => admin.user_id)
    if (!adminIds.length) return []

    if (reopenAfterMs) {
        const { error } = await supabase.from('notification_incidents').update<IncidentUpdate>({ resolved_at: now.toISOString() }).eq('source_key', key).is('resolved_at', null).lt('opened_at', new Date(now.getTime() - reopenAfterMs).toISOString())
        if (error) console.error('[alert] failed to close a stale alert', error)
    }
    const [{ data: users }, { data: open }, presence] = await Promise.all([
        selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: adminIds }),
        selectMany(supabase, 'notification_incidents', ['user_id'] as const, { source_key: key, resolved_at: { isNull: true } }),
        awayOnly ? loadPresence(supabase, adminIds) : [],
    ])
    const told = new Set((open ?? []).map(incident => incident.user_id))
    const online = new Set(presence.filter(row => isPresent(row.last_seen_at, now)).map(row => row.user_id))
    return (users ?? []).filter(user => !told.has(user.id) && !online.has(user.id) && wantsCategoryEmail(user.email_notification_prefs, 'billing')).map(user => user.id)
}

export type AlertAddress = { to: string; locale: Locale; unsubscribeUrl: string }

export async function sendAlert(supabase: Client, { workspaceId, key, brand = RERUN_BRAND }: AdminAlert, adminIds: string[], send: (address: AlertAddress) => Promise<SendEmailResult>): Promise<void> {
    const results = await Promise.allSettled(
        adminIds.map(async userId => {
            const recipient = await loadEmailRecipient(supabase, userId)
            if (!recipient) return
            const address = { to: recipient.email, locale: await recipientLocale(supabase, userId, workspaceId), unsubscribeUrl: `${buildUnsubscribeUrl(userId, brandAppUrl(brand))}&category=billing` }
            const { data: opened, error } = await supabase.rpc('open_notification_incident', { p_user_id: userId, p_source_key: key })
            if (error) throw new Error(error.message)
            if (!opened) return
            // An alert stays open only once its email has left, or nobody would ever hear of it.
            const sent = await send(address).catch((reason: unknown): SendEmailResult => {
                console.error('[alert] failed to send', reason)
                return { ok: false, error: String(reason) }
            })
            if (sent.ok) return
            const { error: dropError } = await supabase.from('notification_incidents').delete().eq('user_id', userId).eq('source_key', key)
            if (dropError) console.error('[alert] failed to drop an alert nobody was emailed about', dropError)
        }),
    )
    for (const result of results) if (result.status === 'rejected') console.error('[alert] failed to alert an admin', result.reason)
}

export async function resolveAlert(supabase: Client, key: string): Promise<void> {
    const { error } = await supabase.rpc('resolve_notification_incidents', { p_source_key: key })
    if (error) console.error('[alert] failed to close', error)
}
