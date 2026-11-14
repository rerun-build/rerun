import { attachmentTool } from '@/lib/apps/attachment-tool'
import { LinkupError, runAction } from '@/lib/apps/linkup/client'
import type { AppScope, AppTool } from '@/lib/apps/tools'
import { whatsappSessionClosed } from './connect'
import type { QuotaAction } from './quotas'

// The WhatsApp tools a coworker gets. Linkup documents list_inbox for LinkedIn and email only, but
// it answers for a WhatsApp account too (checked on staging, 19/10/2026), groups included. Its
// category filter is ignored for WhatsApp, so the tool does not offer one.

export const WHATSAPP_SCOPES = {
    messages: { summary: "forwarding, reacting to, editing and deleting a message, the typing indicator, older history, declining a call, a contact's profile" },
    chats: { summary: 'archiving, pinning, muting and deleting a chat' },
    groups: { summary: 'creating a group, its details, its participants and invite link, leaving it' },
} satisfies Record<string, AppScope>

export type WhatsappTool = AppTool<QuotaAction, keyof typeof WHATSAPP_SCOPES>

const phoneNumber = { type: 'string', description: 'Number in international format, e.g. +33612345678' }
const count = (max: number) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many to return, at most ${max}.` })

const conversationId = { type: 'string', description: 'From whatsapp_pro_list_conversations; a group id ends in @g.us' }
const phoneNumbers = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

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

// A forward to a chat named by its conversation_id goes to someone the number already talks to.
async function isNewRecipient(accountId: string, params: Record<string, unknown>): Promise<QuotaAction | null> {
    return params.phone_number ? isNewConversation(accountId, params) : null
}

// Adding people to a group reaches them the way a first message does.
async function addsToGroup(_accountId: string, params: Record<string, unknown>): Promise<QuotaAction | null> {
    return params.operation === 'add' ? 'new_conversation' : null
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
        name: 'get_contact_profile',
        scope: 'messages',
        description: 'The WhatsApp profile of a number: display name, about text, picture and, for a WhatsApp Business number, its business profile.',
        inputSchema: { type: 'object', properties: { phone_number: phoneNumber }, required: ['phone_number'] },
        category: 'profiles',
        action: 'get',
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
        inputSchema: { type: 'object', properties: { archived: { type: 'boolean', description: 'true lists only the archived chats, false leaves them out' }, count: count(50), cursor: { type: 'string' } } },
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
        name: 'forward_message',
        scope: 'messages',
        description: 'Forward a message, by its id from whatsapp_pro_get_conversation, to a number or to a chat. The same care as a sent message: only to people who expect to hear from the user.',
        inputSchema: { type: 'object', properties: { message_id: { type: 'string' }, phone_number: phoneNumber, conversation_id: conversationId }, required: ['message_id'] },
        category: 'messages',
        action: 'forward_message',
        quota: { action: 'message' },
        extraQuota: isNewRecipient,
    },
    {
        name: 'react_to_message',
        scope: 'messages',
        description: 'Put an emoji reaction on a message, by its id from whatsapp_pro_get_conversation, or take it off with remove: true.',
        inputSchema: { type: 'object', properties: { message_id: { type: 'string' }, emoji: { type: 'string' }, remove: { type: 'boolean' } }, required: ['message_id', 'emoji'] },
        category: 'messages',
        action: 'react_message',
    },
    {
        name: 'edit_message',
        scope: 'messages',
        description: 'Change the text of a text message the user sent, within 15 minutes of sending it.',
        inputSchema: { type: 'object', properties: { message_id: { type: 'string' }, message_text: { type: 'string' } }, required: ['message_id', 'message_text'] },
        category: 'messages',
        action: 'edit_message',
    },
    {
        name: 'delete_message',
        scope: 'messages',
        description: 'Delete a message the user sent, for everyone, within about 2.5 days of sending it.',
        inputSchema: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] },
        category: 'messages',
        action: 'delete_message',
    },
    {
        name: 'send_typing',
        scope: 'messages',
        description: 'Show "typing…", or "recording audio…" with recording: true, in a chat for a few seconds, before a reply that takes time.',
        inputSchema: { type: 'object', properties: { phone_number: phoneNumber, conversation_id: conversationId, recording: { type: 'boolean' } } },
        category: 'messages',
        action: 'typing',
    },
    {
        name: 'sync_history',
        scope: 'messages',
        description: 'Pull older messages of a chat from the phone, 50 at most, when whatsapp_pro_get_conversation stops short. They show up there a few seconds later.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, count: count(50) }, required: ['conversation_id'] },
        category: 'messages',
        action: 'sync_history',
        clamp: { count: { default: 50, max: 50 } },
    },
    {
        name: 'reject_call',
        scope: 'messages',
        description: 'Decline an incoming WhatsApp call by its call_id.',
        inputSchema: { type: 'object', properties: { call_id: { type: 'string' } }, required: ['call_id'] },
        category: 'messages',
        action: 'reject_call',
    },
    {
        name: 'archive_conversation',
        scope: 'chats',
        description: 'Archive a chat, or bring it back with archived: false.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, archived: { type: 'boolean' } }, required: ['conversation_id'] },
        category: 'messages',
        action: 'archive_conversation',
    },
    {
        name: 'pin_conversation',
        scope: 'chats',
        description: 'Pin a chat at the top of the list, or unpin it with pinned: false.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, pinned: { type: 'boolean' } }, required: ['conversation_id'] },
        category: 'messages',
        action: 'pin_conversation',
    },
    {
        name: 'mute_conversation',
        scope: 'chats',
        description: 'Mute a chat for duration_hours, or for good without it. muted: false unmutes it.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, duration_hours: { type: 'number' }, muted: { type: 'boolean' } }, required: ['conversation_id'] },
        category: 'messages',
        action: 'mute_conversation',
    },
    {
        name: 'delete_conversation',
        scope: 'chats',
        description: "Remove a chat from the user's chat list. The other person keeps it.",
        inputSchema: { type: 'object', properties: { conversation_id: conversationId }, required: ['conversation_id'] },
        category: 'messages',
        action: 'delete_conversation',
    },
    {
        name: 'create_group',
        scope: 'groups',
        description: 'Create a WhatsApp group with the user as admin. Only with people who know the user: WhatsApp bans numbers that add strangers. Answers the conversation_id of the group.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' }, participants: phoneNumbers('Numbers in international format') }, required: ['name', 'participants'] },
        category: 'messages',
        action: 'create_group',
        quota: { action: 'new_conversation' },
    },
    {
        name: 'get_group',
        scope: 'groups',
        description: 'A group: name, description, and participants with who is admin.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId }, required: ['conversation_id'] },
        category: 'messages',
        action: 'get_group',
    },
    {
        name: 'update_group',
        scope: 'groups',
        description: 'Rename a group or change its description. The user must be an admin.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, name: { type: 'string' }, description: { type: 'string' } }, required: ['conversation_id'] },
        category: 'messages',
        action: 'update_group',
    },
    {
        name: 'update_group_participants',
        scope: 'groups',
        description:
            'Add, remove, promote to admin or demote participants of a group the user admins. Answers one result per number: a reason privacy_settings means the person must join by the link of get_group_invite_link.',
        inputSchema: {
            type: 'object',
            properties: { conversation_id: conversationId, participants: phoneNumbers('Numbers in international format'), operation: { type: 'string', enum: ['add', 'remove', 'promote', 'demote'] } },
            required: ['conversation_id', 'participants', 'operation'],
        },
        category: 'messages',
        action: 'update_group_participants',
        extraQuota: addsToGroup,
    },
    {
        name: 'get_group_invite_link',
        scope: 'groups',
        description: 'The invite link of a group, or a new one with revoke: true, which stops the old link.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId, revoke: { type: 'boolean' } }, required: ['conversation_id'] },
        category: 'messages',
        action: 'get_group_invite_link',
    },
    {
        name: 'leave_group',
        scope: 'groups',
        description: 'Leave a group. Only when the user asked for it.',
        inputSchema: { type: 'object', properties: { conversation_id: conversationId }, required: ['conversation_id'] },
        category: 'messages',
        action: 'leave_group',
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
