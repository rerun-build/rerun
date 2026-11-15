import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { WhatsAppLanguage, WhatsAppMessage } from './templates'

type MessageInsert = Database['public']['Tables']['whatsapp_messages']['Insert']
type MessageUpdate = Database['public']['Tables']['whatsapp_messages']['Update']

const UNIQUE_VIOLATION = '23505'

const PROGRESS = ['pending', 'accepted', 'sent', 'delivered', 'read'] as const
export type WhatsAppProgress = Exclude<(typeof PROGRESS)[number], 'pending' | 'accepted'>
export type WhatsAppFailureStatus = 'failed' | 'rejected'

const PROGRESS_DATE = { sent: 'sent_at', delivered: 'delivered_at', read: 'read_at' } as const satisfies Record<WhatsAppProgress, keyof MessageUpdate>

const FAILABLE = ['pending', 'accepted', 'sent']

const OWNER_COLUMNS = ['user_id', 'phone'] as const

export type ClaimInput = {
    userId: string
    workspaceId: number | null
    agentId: string | null
    phone: string
    message: Pick<WhatsAppMessage, 'key' | 'category'>
    language: WhatsAppLanguage
    dedupeKey: string | null
}

export type ClaimOutcome = { outcome: 'claimed'; id: string } | { outcome: 'duplicate' } | { outcome: 'failed' }

export async function claimWhatsAppMessage(supabase: SupabaseClient<Database>, input: ClaimInput): Promise<ClaimOutcome> {
    const { data, error } = await supabase
        .from('whatsapp_messages')
        .insert<MessageInsert>({
            user_id: input.userId,
            workspace_id: input.workspaceId,
            agent_id: input.agentId,
            phone: input.phone,
            template_key: input.message.key,
            language: input.language,
            category: input.message.category,
            dedupe_key: input.dedupeKey,
        })
        .select('id')
        .single()

    if (data) return { outcome: 'claimed', id: data.id }
    if (error?.code === UNIQUE_VIOLATION) return { outcome: 'duplicate' }
    console.error('[whatsapp] failed to record a message', error?.message)
    return { outcome: 'failed' }
}

export async function releaseWhatsAppMessage(supabase: SupabaseClient<Database>, id: string): Promise<void> {
    const { error } = await supabase.from('whatsapp_messages').delete().eq('id', id)
    if (error) console.error('[whatsapp] failed to release a message', error.message)
}

async function advance(supabase: SupabaseClient<Database>, id: string, status: (typeof PROGRESS)[number]): Promise<boolean> {
    const behind = PROGRESS.slice(0, PROGRESS.indexOf(status))
    const { error } = await supabase.from('whatsapp_messages').update<MessageUpdate>({ status }).eq('id', id).in('status', behind)
    if (error) console.error('[whatsapp] failed to advance a message', error.message)
    return !error
}

export async function markWhatsAppMessageAccepted(supabase: SupabaseClient<Database>, id: string, birdMessageId: string): Promise<void> {
    const { error } = await supabase.from('whatsapp_messages').update<MessageUpdate>({ bird_message_id: birdMessageId }).eq('id', id)
    if (error) console.error('[whatsapp] failed to keep a Bird id', error.message)
    await advance(supabase, id, 'accepted')
}

export async function applyWhatsAppProgress(supabase: SupabaseClient<Database>, id: string, event: { status: WhatsAppProgress; at: string; birdMessageId: string }): Promise<boolean> {
    const { error } = await supabase
        .from('whatsapp_messages')
        .update<MessageUpdate>({ [PROGRESS_DATE[event.status]]: event.at, bird_message_id: event.birdMessageId })
        .eq('id', id)
    if (error) {
        console.error('[whatsapp] failed to date a message', error.message)
        return false
    }
    return advance(supabase, id, event.status)
}

export type WhatsAppFailure = { status: WhatsAppFailureStatus; at: string; code: string | null; metaCode: string | null; description: string | null }

export async function applyWhatsAppFailure(supabase: SupabaseClient<Database>, id: string, failure: WhatsAppFailure): Promise<boolean> {
    const { error } = await supabase
        .from('whatsapp_messages')
        .update<MessageUpdate>({ status: failure.status, failed_at: failure.at, error_code: failure.code, meta_error_code: failure.metaCode, error: failure.description })
        .eq('id', id)
        .in('status', FAILABLE)
    if (error) console.error('[whatsapp] failed to record a failure', error.message)
    return !error
}

export async function loadWhatsAppMessageOwner(supabase: SupabaseClient<Database>, id: string): Promise<{ user_id: string; phone: string } | null> {
    const { data } = await selectMaybeSingle(supabase, 'whatsapp_messages', OWNER_COLUMNS, { id })
    return data
}
