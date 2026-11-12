import { attachmentTool } from '@/lib/apps/attachment-tool'
import { LinkupError, runAction } from '@/lib/apps/linkup/client'
import type { AppTool } from '@/lib/apps/tools'
import { whatsappSessionClosed } from './connect'
import type { QuotaAction } from './quotas'

// The WhatsApp tools a coworker gets. Linkup documents list_inbox for LinkedIn and email only, but
// it answers for a WhatsApp account too (checked on staging, 19/10/2026), groups included. Its
// category filter is ignored for WhatsApp, so the tool does not offer one.

export type WhatsappTool = AppTool<QuotaAction>

const phoneNumber = { type: 'string', description: 'Number in international format, e.g. +33612345678' }
const count = (max: number) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many to return, at most ${max}.` })

type ConversationPage = { messages?: unknown[]; total_message_count?: number }

// A number the account never wrote to nor heard from: what WhatsApp watches for spam. Linkup
// answers a chat it has never seen with an error rather than an empty page.
export async function isNewConversation(accountId: string, params: Record<string, unknown>): Promise<QuotaAction | null> {
    try {
        const page = await runAction<ConversationPage>(accountId, 'messages', 'get_conversation', { phone_number: params.phone_number, count: 1 })
        const known = (page.total_message_count ?? page.messages?.length ?? 0) > 0
        return known ? null : 'new_conversation'
    } catch (err) {
        if (err instanceof LinkupError && whatsappSessionClosed(err)) throw err
        if (err instanceof LinkupError && (err.code === 'CHANNEL_ERROR' || err.code === 'INVALID_PARAMS')) return 'new_conversation'
        throw err
    }
}

export const WHATSAPP_TOOLS: WhatsappTool[] = [
    {
        name: 'get_my_profile',
        description: 'The WhatsApp number you act with: its number, display name, about text and, for a WhatsApp Business number, its business profile.',
        inputSchema: { type: 'object', properties: {} },
        category: 'profiles',
        action: 'get_me',
    },
    {
        name: 'check_numbers',
        description: 'Which phone numbers have WhatsApp, up to 50 per call. Nothing is sent to them.',
        inputSchema: { type: 'object', properties: { phone_numbers: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Numbers in international format' } }, required: ['phone_numbers'] },
        category: 'messages',
        action: 'check_numbers',
        quota: { action: 'number_check', amount: args => (Array.isArray(args.phone_numbers) ? Math.min(args.phone_numbers.length, 50) : 1) },
    },
    {
        name: 'list_conversations',
        description:
            "The user's WhatsApp chats, most recent first: each with its conversation_id, the other person's number (none for a group), the last message and the unread count. Pass next_cursor from the last answer to go further back.",
        inputSchema: { type: 'object', properties: { count: count(50), cursor: { type: 'string' } } },
        category: 'messages',
        action: 'list_inbox',
        clamp: { count: { default: 20, max: 50 } },
    },
    {
        name: 'get_conversation',
        description:
            'The messages of one chat, most recent first, by the other person’s phone_number or by a conversation_id from whatsapp_pro_list_conversations (the only way to read a group). A message the user sent carries is_me. Pass next_cursor from the last answer to go further back. Read it before every message you send. To open a voice note, image or file in a message, pass its download_url to whatsapp_pro_download_attachment.',
        inputSchema: { type: 'object', properties: { phone_number: phoneNumber, conversation_id: { type: 'string' }, count: count(50), cursor: { type: 'string' } } },
        category: 'messages',
        action: 'get_conversation',
        clamp: { count: { default: 20, max: 50 } },
    },
    {
        name: 'send_message',
        description:
            'Send a WhatsApp message to a number, as the user. Only to people who expect to hear from them: WhatsApp bans numbers that message strangers. Read the conversation with whatsapp_pro_get_conversation first and never send the same message twice. Attach files by public URL; an audio file goes as a voice note. To reply to one message, pass its id from the conversation as quoted_message_id.',
        inputSchema: {
            type: 'object',
            properties: {
                phone_number: phoneNumber,
                message_text: { type: 'string' },
                media_links: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Public URLs of files to attach' },
                voice_message: { type: 'boolean', description: 'Send the attached audio as a voice note even without an audio extension' },
                quoted_message_id: { type: 'string', description: 'The id of the message this one replies to' },
            },
            required: ['phone_number'],
        },
        category: 'messages',
        action: 'send',
        quota: { action: 'message' },
        extraQuota: isNewConversation,
    },
    {
        name: 'post_status',
        description:
            "Post a WhatsApp Status from the user's number: a story that stays 24 hours, seen by the contacts they recently chatted with, or only by phone_numbers. Nobody gets a message. Give a text, or an image or video by public URL with the text as its caption. Answers the Status id, how many people can see it and when it expires.",
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'The text of the Status, or the caption of the image or video' },
                file: { type: 'string', description: 'Public URL of one image or video' },
                phone_numbers: { type: 'array', items: { type: 'string' }, maxItems: 500, description: 'Who sees it, in international format. Leave out for the 500 most recent one-to-one chats' },
                background_color: { type: 'string', description: 'Background of a text Status, as hex, e.g. #25D366' },
                font: { type: 'integer', minimum: 0, maximum: 5, description: 'Font of a text Status, 0 to 5' },
            },
        },
        category: 'content',
        action: 'create',
    },
    attachmentTool('attachment_download'),
]
