import type { AttachmentSummary } from '@/lib/apps/attachments'
import type { AttachmentRef } from '@/lib/apps/linkup/client'
import { WAKE_ACCOUNT_HINT, type EnvelopeKind, type LinkupEnvelope, type LinkupPerson, type WakeAccount } from '@/lib/apps/linkup/envelope'
import { WAKE_EVENT_LABELS, isWakeEvent, type WakeEvent } from './wake-events'

export { WAKE_EVENTS, WAKE_EVENT_LABELS, isWakeEvent, type WakeEvent } from './wake-events'

// What a LinkedIn delivery means to the coworkers woken by it.

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

// A file in classic messaging is named by its conversation, on a Recruiter seat by its message.
// Linkup's own download_url, when the attachment carries one, already holds both.
export function attachmentBase(envelope: LinkupEnvelope): AttachmentRef {
    const { inbox, metadata } = envelope.event
    if (inbox === 'recruiter') return metadata?.entity_urn ? { message_id: metadata.entity_urn } : {}
    return metadata?.conversation_urn ? { conversation_id: metadata.conversation_urn } : {}
}

// What the coworker reads in its trigger payload: the event in plain words, without Linkup's URNs
// and cursors. A file comes as a link it can open and, for a voice note, its words.
export function wakePayload(event: WakeEvent, envelope: LinkupEnvelope, account: WakeAccount, attachments: AttachmentSummary[] = []): Record<string, unknown> {
    const base = { app: 'linkedin', event, account: account.label, accountId: account.id, at: envelope.event.timestamp ?? envelope.timestamp ?? null }
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

// The prompt the hub writes on the trigger it creates. The user can rewrite it in the trigger
// editor like any other.
export function wakeTriggerPrompt(events: WakeEvent[]): string {
    const what = events.map(event => WAKE_EVENT_LABELS[event].toLowerCase()).join(', or ')
    return [
        `Something happened on the LinkedIn account you work with: ${what}. The details are in the payload below.`,
        'Decide whether it calls for anything from you given your role and what you already know about this person. If it does, act with your LinkedIn tools (read the conversation before you reply, never send the same message twice). If it does not, stop without doing anything.',
        'A voice note comes with its transcript. Every file comes with a url that serves it for 24 hours with no sign-in, to hand as is to any tool or API that takes a file URL. When a transcript is missing, or to keep a copy in your files, pass its downloadUrl to linkedin_pro_download_attachment.',
        WAKE_ACCOUNT_HINT,
    ].join('\n\n')
}
