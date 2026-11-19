import { describe, expect, it } from 'vitest'
import { parseEnvelope } from '@/lib/apps/linkup/envelope'
import type { AttachmentSummary } from '@/lib/apps/attachments'
import { attachmentBase, envelopeKind, wakePayload } from './events'

const MESSAGE = JSON.stringify({
    event_id: 'evt_wa_1',
    account_id: 'acc_wa',
    platform: 'whatsapp',
    event: {
        type: 'message',
        timestamp: '2026-10-19T09:12:00.000000',
        message_text: 'Bonjour, is the table for four still free tonight?',
        sender: { name: 'Jane Doe', phone_number: '33612345678', jid: '33612345678@s.whatsapp.net' },
        conversation_id: '33612345678@s.whatsapp.net',
        is_group_chat: false,
        message_id: '3EB0C1A2B3D4E5F6A7B8',
    },
})

describe('envelopeKind', () => {
    it('wakes on a message somebody else sent', () => {
        expect(envelopeKind(parseEnvelope(MESSAGE)!)).toEqual({ kind: 'wake', event: 'message_received' })
    })

    it('ignores what the user typed on their own phone', () => {
        expect(envelopeKind({ account_id: 'a', event: { type: 'message', direction: 'outbound' } })).toEqual({ kind: 'ignored' })
        expect(envelopeKind({ account_id: 'a', event: { type: 'message', sender: { is_self_sent: true } } })).toEqual({ kind: 'ignored' })
    })

    it('tells a disconnection apart and ignores the receipts', () => {
        expect(envelopeKind({ account_id: 'a', event: { type: 'disconnection' } })).toEqual({ kind: 'disconnection', reason: 'WhatsApp unlinked the number' })
        expect(envelopeKind({ account_id: 'a', event: { type: 'message_delivered' } })).toEqual({ kind: 'ignored' })
    })
})

describe('wakePayload', () => {
    it('hands the coworker the number every WhatsApp tool takes', () => {
        expect(wakePayload('message_received', parseEnvelope(MESSAGE)!, 'Le Comptoir (+33600000000)')).toEqual({
            app: 'whatsapp',
            event: 'message_received',
            account: 'Le Comptoir (+33600000000)',
            at: '2026-10-19T09:12:00.000000',
            from: { name: 'Jane Doe', phoneNumber: '+33612345678' },
            text: 'Bonjour, is the table for four still free tonight?',
            groupChat: false,
            conversationId: '33612345678@s.whatsapp.net',
            messageId: '3EB0C1A2B3D4E5F6A7B8',
        })
    })

    it('reads the number from the chat when the sender carries none, but never from a group', () => {
        const direct = wakePayload('message_received', { account_id: 'a', event: { type: 'message', message_text: 'hi', conversation_id: '447700900123@s.whatsapp.net' } }, null)
        expect(direct.from).toEqual({ name: null, phoneNumber: '+447700900123' })
        const group = wakePayload('message_received', { account_id: 'a', event: { type: 'message', message_text: 'hi', conversation_id: '120363025@g.us' } }, null)
        expect(group).toMatchObject({ groupChat: true, from: { name: null, phoneNumber: null } })
    })
})

describe('attachments', () => {
    it('names a WhatsApp file by its message', () => {
        expect(attachmentBase(parseEnvelope(MESSAGE)!)).toEqual({ message_id: '3EB0C1A2B3D4E5F6A7B8' })
        expect(attachmentBase({ account_id: 'a', event: { type: 'message' } })).toEqual({})
    })

    it('hands the coworker each file as it was summarized, and nothing when there is none', () => {
        const voice: AttachmentSummary = { type: 'audio', name: 'audio-3EB0.ogg', mimeType: 'audio/ogg', byteSize: 41_000, durationMs: 12_000, downloadUrl: '/v2/messages/attachment?message_id=3EB0', url: 'https://moldwright.robagentic.tech/api/public/attachments/t/audio-3EB0.ogg', expiresAt: '2026-10-29T09:12:00.000Z', transcript: 'On se voit demain' }
        expect(wakePayload('message_received', parseEnvelope(MESSAGE)!, null, [voice]).attachments).toEqual([voice])
        expect(wakePayload('message_received', parseEnvelope(MESSAGE)!, null)).not.toHaveProperty('attachments')
    })
})
