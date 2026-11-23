import { describe, expect, it } from 'vitest'
import type { AttachmentSummary } from '@/lib/apps/attachments'
import { parseEnvelope } from '@/lib/apps/linkup/envelope'
import { attachmentBase, envelopeKind, wakePayload } from './events'

const MESSAGE = JSON.stringify({
    event_id: 'evt_1',
    account_id: 'acc_1',
    platform: 'linkedin',
    event: {
        type: 'message',
        inbox: 'classic',
        timestamp: '2026-04-28T10:07:45.525693',
        message_text: 'Hello! I would love to connect.',
        sender: { name: 'John Doe', profile_url: 'https://www.linkedin.com/in/ACoAAEMT' },
        conversation: { is_group_chat: false },
        metadata: { conversation_urn: 'urn:li:msg_conversation:1', entity_urn: 'urn:li:msg_message:1' },
    },
})

describe('envelopeKind', () => {
    it('reads a message as message_received, the name it is subscribed under', () => {
        expect(envelopeKind(parseEnvelope(MESSAGE)!)).toEqual({ kind: 'wake', event: 'message_received' })
    })

    it('tells a disconnection apart and ignores what it does not know', () => {
        expect(envelopeKind({ account_id: 'a', event: { type: 'disconnection', reason: 'cookie expired' } })).toEqual({ kind: 'disconnection', reason: 'cookie expired' })
        expect(envelopeKind({ account_id: 'a', event: { type: 'email_bounced' } })).toEqual({ kind: 'ignored' })
    })
})

describe('wakePayload', () => {
    it('hands the coworker the message in plain words', () => {
        expect(wakePayload('message_received', parseEnvelope(MESSAGE)!, { label: 'Jane Doe', id: 'jane-doe' })).toEqual({
            app: 'linkedin',
            event: 'message_received',
            account: 'Jane Doe',
            accountId: 'jane-doe',
            at: '2026-04-28T10:07:45.525693',
            inbox: 'classic',
            from: { name: 'John Doe', profileUrl: 'https://www.linkedin.com/in/ACoAAEMT' },
            text: 'Hello! I would love to connect.',
            groupChat: false,
            conversationId: 'urn:li:msg_conversation:1',
        })
    })
})

describe('attachments', () => {
    it('names a classic file by its conversation and a Recruiter one by its message', () => {
        expect(attachmentBase({ account_id: 'a', event: { type: 'message', metadata: { conversation_urn: 'urn:li:msg_conversation:1', entity_urn: 'urn:li:msg_message:2' } } })).toEqual({ conversation_id: 'urn:li:msg_conversation:1' })
        expect(attachmentBase({ account_id: 'a', event: { type: 'message', inbox: 'recruiter', metadata: { entity_urn: 'urn:li:ts_msg_message:2' } } })).toEqual({ message_id: 'urn:li:ts_msg_message:2' })
    })

    it('hands the coworker the files of a message', () => {
        const pdf: AttachmentSummary = { type: 'file', name: 'proposal.pdf', mimeType: 'application/pdf', byteSize: 184_320, durationMs: null, downloadUrl: '/v2/messages/attachment?conversation_id=c&asset_urn=a', url: null, expiresAt: null }
        const payload = wakePayload('message_received', { account_id: 'a', event: { type: 'message', message_text: 'Voici le devis' } }, { label: null, id: null }, [pdf])
        expect(payload.attachments).toEqual([pdf])
    })
})
