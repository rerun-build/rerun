import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { sendWhatsAppTemplate } from './client'
import { loadWhatsAppRecipient } from './recipient'
import { applyWhatsAppFailure, claimWhatsAppMessage, markWhatsAppMessageAccepted, releaseWhatsAppMessage } from './store'
import type { WhatsAppLanguage, WhatsAppMessage } from './templates'

export type DeliverWhatsAppInput = {
    userId: string
    workspaceId?: number | null
    agentId?: string | null
    message: WhatsAppMessage
    language: WhatsAppLanguage
    dedupeKey?: string | null
}

export type DeliverWhatsAppResult = { sent: true; id: string } | { sent: false; reason: string }

export const MESSAGE_ID_METADATA = 'message_id'

export async function deliverWhatsApp(supabase: SupabaseClient<Database>, input: DeliverWhatsAppInput): Promise<DeliverWhatsAppResult> {
    const recipient = await loadWhatsAppRecipient(supabase, input.userId, input.message.category)
    if (!recipient.ok) return { sent: false, reason: recipient.reason }

    const claim = await claimWhatsAppMessage(supabase, {
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        agentId: input.agentId ?? null,
        phone: recipient.phone,
        message: input.message,
        language: input.language,
        dedupeKey: input.dedupeKey ?? null,
    })
    if (claim.outcome !== 'claimed') return { sent: false, reason: claim.outcome === 'duplicate' ? 'duplicate' : 'record_failed' }

    const result = await sendWhatsAppTemplate({
        to: recipient.phone,
        slug: input.message.slug,
        language: input.language,
        components: input.message.components,
        idempotencyKey: `whatsapp:${claim.id}`,
        tags: [{ name: 'template', value: input.message.key }],
        metadata: { [MESSAGE_ID_METADATA]: claim.id },
    })

    if (result.ok && result.id) {
        await markWhatsAppMessageAccepted(supabase, claim.id, result.id)
        return { sent: true, id: claim.id }
    }

    if (result.ok || result.error === 'rate_limited') {
        await releaseWhatsAppMessage(supabase, claim.id)
        return { sent: false, reason: result.ok ? 'delivery_disabled' : 'rate_limited' }
    }

    await applyWhatsAppFailure(supabase, claim.id, { status: 'rejected', at: new Date().toISOString(), code: result.error, metaCode: null, description: result.detail })
    return { sent: false, reason: result.error }
}
