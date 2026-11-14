import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { countryOfE164 } from '@/lib/phone/normalize'
import { reachableChannels } from '@/lib/phone/reach'
import type { WhatsAppCategory } from './templates'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type UserPhoneUpdate = Database['public']['Tables']['user_phones']['Update']

export type WhatsAppRefusal = 'no_phone' | 'unverified' | 'no_consent' | 'opted_out' | 'unreachable' | 'unsupported_country' | 'marketing_paused'
export type WhatsAppRecipient = { ok: true; phone: string } | { ok: false; reason: WhatsAppRefusal }

const RECIPIENT_COLUMNS = ['phone', 'verified_at', 'contact_consent_at', 'whatsapp_opted_out_at', 'whatsapp_unreachable_at'] as const

function standsFor(flaggedAt: string | null, verifiedAt: string): boolean {
    return !!flaggedAt && new Date(flaggedAt) >= new Date(verifiedAt)
}

export async function loadWhatsAppRecipient(supabase: SupabaseClient<Database>, userId: string, category: WhatsAppCategory): Promise<WhatsAppRecipient> {
    const { data } = await selectMaybeSingle(supabase, 'user_phones', RECIPIENT_COLUMNS, { user_id: userId })

    if (!data?.phone) return { ok: false, reason: 'no_phone' }
    if (!data.verified_at) return { ok: false, reason: 'unverified' }
    if (!data.contact_consent_at) return { ok: false, reason: 'no_consent' }
    if (standsFor(data.whatsapp_opted_out_at, data.verified_at)) return { ok: false, reason: 'opted_out' }
    if (standsFor(data.whatsapp_unreachable_at, data.verified_at)) return { ok: false, reason: 'unreachable' }
    const country = countryOfE164(data.phone)
    if (!reachableChannels(country, 'rerun').includes('whatsapp')) return { ok: false, reason: 'unsupported_country' }
    if (category === 'marketing' && !reachableChannels(country, 'rerun_marketing').includes('whatsapp')) return { ok: false, reason: 'marketing_paused' }
    return { ok: true, phone: data.phone }
}

async function flag(supabase: SupabaseClient<Database>, phone: string, update: UserPhoneUpdate): Promise<boolean> {
    const { error } = await supabase.from('user_phones').update<UserPhoneUpdate>(update).eq('phone', phone)
    if (error) console.error('[whatsapp] failed to flag a number', error.message)
    return !error
}

export function setWhatsAppOptOut(supabase: SupabaseClient<Database>, phone: string, optedOutAt: string | null): Promise<boolean> {
    return flag(supabase, phone, { whatsapp_opted_out_at: optedOutAt })
}

export function markWhatsAppUnreachable(supabase: SupabaseClient<Database>, phone: string, at: string): Promise<boolean> {
    return flag(supabase, phone, { whatsapp_unreachable_at: at })
}

export function markWhatsAppReplied(supabase: SupabaseClient<Database>, phone: string, at: string): Promise<boolean> {
    return flag(supabase, phone, { whatsapp_replied_at: at })
}
