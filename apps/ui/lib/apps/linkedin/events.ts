import type { AttachmentSummary } from '@/lib/apps/attachments'
import type { AttachmentRef } from '@/lib/apps/linkup/client'
import type { EnvelopeKind, LinkupEnvelope, LinkupPerson } from '@/lib/apps/linkup/envelope'
import { WAKE_EVENT_LABELS, isWakeEvent, type WakeEvent } from './wake-events'

export { WAKE_EVENTS, WAKE_EVENT_LABELS, isWakeEvent, type WakeEvent } from './wake-events'

export function envelopeKind(envelope: LinkupEnvelope): EnvelopeKind<WakeEvent> {
    const type = envelope.event.type
    if (type === 'disconnection') return { kind: 'disconnection', reason: envelope.event.reason ?? 'LinkedIn ended the session' }
    if (type === 'message') return { kind: 'wake', event: 'message_received' }
    if (isWakeEvent(type)) return { kind: 'wake', event: type }
    return { kind: 'ignored' }
}

function person(entry: LinkupPerson | undefined): Record<string, string> | undefined {
    if (!entry) return undefined
    const out: Record<string, string> = {}
    if (entry.name) out.name = entry.name
    if (entry.profile_url) out.profileUrl = entry.profile_url
    if (entry.job_title || entry.subtitle) out.headline = (entry.job_title || entry.subtitle) as string
    if (entry.message) out.note = entry.message
    return out
}

export function attachmentBase(envelope: LinkupEnvelope): AttachmentRef {
    const { inbox, metadata } = envelope.event
    if (inbox === 'recruiter') return metadata?.entity_urn ? { message_id: metadata.entity_urn } : {}
    return metadata?.conversation_urn ? { conversation_id: metadata.conversation_urn } : {}
}

export function wakePayload(event: WakeEvent, envelope: LinkupEnvelope, accountLabel: string | null, attachments: AttachmentSummary[] = []): Record<string, unknown> {
    const base = { app: 'linkedin', event, account: accountLabel, at: envelope.event.timestamp ?? envelope.timestamp ?? null }
    if (event === 'message_received') {
        return {
            ...base,
            inbox: envelope.event.inbox ?? 'classic',
            from: person(envelope.event.sender),
            text: envelope.event.message_text ?? '',
            ...(envelope.event.reply_to?.message_text ? { inReplyTo: envelope.event.reply_to.message_text } : {}),
            ...(attachments.length ? { attachments } : {}),
            groupChat: envelope.event.conversation?.is_group_chat ?? false,
            conversationId: envelope.event.metadata?.conversation_urn ?? null,
        }
    }
    if (event === 'accepted_invitation') return { ...base, people: (envelope.event.new_connections ?? []).map(person) }
    return { ...base, people: (envelope.event.new_invitations ?? []).map(person) }
}

export function wakeTriggerPrompt(events: WakeEvent[]): string {
    const what = events.map(event => WAKE_EVENT_LABELS[event].toLowerCase()).join(', or ')
    return [
        `Something happened on the LinkedIn account you work with: ${what}. The details are in the payload below.`,
        'Decide whether it calls for anything from you given your role and what you already know about this person. If it does, act with your LinkedIn tools (read the conversation before you reply, never send the same message twice). If it does not, stop without doing anything.',
        'A voice note comes with its transcript. Every file comes with a url that serves it for 24 hours with no sign-in, to hand as is to any tool or API that takes a file URL. When a transcript is missing, or to keep a copy in your files, pass its downloadUrl to linkedin_pro_download_attachment.',
    ].join('\n\n')
}
