import type { AttachmentSummary } from '@/lib/apps/attachments'
import type { AttachmentRef } from '@/lib/apps/linkup/client'
import type { EnvelopeKind, LinkupEnvelope } from '@/lib/apps/linkup/envelope'
import { WAKE_EVENT_LABELS, type WakeEvent } from './wake-events'

function isOutbound(envelope: LinkupEnvelope): boolean {
    return envelope.event.direction === 'outbound' || envelope.event.sender?.is_self_sent === true
}

export function envelopeKind(envelope: LinkupEnvelope): EnvelopeKind<WakeEvent> {
    const type = envelope.event.type
    if (type === 'disconnection') return { kind: 'disconnection', reason: envelope.event.reason ?? 'WhatsApp unlinked the number' }
    if (type === 'message' && !isOutbound(envelope)) return { kind: 'wake', event: 'message_received' }
    return { kind: 'ignored' }
}

function numberOf(jidOrNumber: string | undefined): string | null {
    const digits = jidOrNumber?.split('@')[0]?.replace(/\D/g, '')
    return digits ? `+${digits}` : null
}

function messageIdOf(envelope: LinkupEnvelope): string | null {
    return envelope.event.message_id ?? envelope.event.metadata?.message_id ?? envelope.event.metadata?.entity_urn ?? null
}

export function attachmentBase(envelope: LinkupEnvelope): AttachmentRef {
    const messageId = messageIdOf(envelope)
    return messageId ? { message_id: messageId } : {}
}

export function wakePayload(event: WakeEvent, envelope: LinkupEnvelope, accountLabel: string | null, attachments: AttachmentSummary[] = []): Record<string, unknown> {
    const { event: body } = envelope
    const conversationId = body.conversation_id ?? body.metadata?.conversation_id ?? body.metadata?.conversation_urn ?? null
    const groupChat = body.is_group_chat ?? body.conversation?.is_group_chat ?? conversationId?.endsWith('@g.us') ?? false
    return {
        app: 'whatsapp',
        event,
        account: accountLabel,
        at: body.timestamp ?? envelope.timestamp ?? null,
        from: { name: body.sender?.name ?? null, phoneNumber: numberOf(body.sender?.phone_number ?? body.sender?.jid) ?? (groupChat ? null : numberOf(conversationId ?? undefined)) },
        text: body.message_text ?? '',
        ...(body.reply_to?.message_text ? { inReplyTo: body.reply_to.message_text } : {}),
        ...(attachments.length ? { attachments } : {}),
        groupChat,
        ...(groupChat && body.conversation?.name ? { group: body.conversation.name } : {}),
        conversationId,
        messageId: messageIdOf(envelope),
    }
}

const ATTACHMENTS_HINT =
    'A voice note comes with its transcript. Every file comes with a url that serves it for 24 hours with no sign-in, to hand as is to any tool or API that takes a file URL. When a transcript is missing, or to keep a copy in your files, pass its downloadUrl to whatsapp_pro_download_attachment.'

export function wakeTriggerPrompt(events: WakeEvent[]): string {
    const what = events.map(event => WAKE_EVENT_LABELS[event].toLowerCase()).join(', or ')
    return [
        `Something happened on the WhatsApp number you work with: ${what}. The details are in the payload below.`,
        'Decide whether it calls for anything from you given your role and what you already know about this person. If it does, read the conversation with your WhatsApp tools before you answer, and never send the same message twice. In a group, answer only when the message is meant for the user. If it calls for nothing, stop without doing anything.',
        ATTACHMENTS_HINT,
    ].join('\n\n')
}
