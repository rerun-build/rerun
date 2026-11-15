import { attachmentTool } from '@/lib/apps/attachment-tool'
import type { AppTool } from '@/lib/apps/tools'
import type { QuotaAction } from './quotas'

export type LinkedinTool = AppTool<QuotaAction>

const profileUrl = { type: 'string', description: 'LinkedIn profile URL, e.g. https://www.linkedin.com/in/jane-doe' }
const count = (max: number) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many to return, at most ${max}.` })

export const LINKEDIN_TOOLS: LinkedinTool[] = [
    {
        name: 'get_my_profile',
        description: "The profile of the LinkedIn account you act with: name, headline, experience. Read it before writing on the user's behalf.",
        inputSchema: { type: 'object', properties: {} },
        category: 'profiles',
        action: 'get_me',
    },
    {
        name: 'get_profile',
        description: 'Read one LinkedIn profile you need to act on (before an invitation or a message). For enriching many profiles at once, use the paid_data tools instead: they do not spend this account’s daily profile views.',
        inputSchema: { type: 'object', properties: { profile_url: profileUrl, identifier: { type: 'string', description: 'Public id from the profile URL, e.g. jane-doe' } } },
        category: 'profiles',
        action: 'get',
        quota: { action: 'profile_view' },
    },
    {
        name: 'search_people',
        description: "Search people on LinkedIn as the user, the way they would in LinkedIn's own search, ranked by their network. Give at least one filter. For bulk lead lists, prefer the paid_data tools.",
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string' },
                title: { type: 'string', description: 'Current job title' },
                company_name: { type: 'string' },
                location: { type: 'string', description: 'City, region or country name' },
                network: { type: 'string', enum: ['F', 'S', 'O'], description: 'F = 1st degree, S = 2nd, O = 3rd and beyond' },
                search_url: { type: 'string', description: 'A LinkedIn people search URL copied from the browser' },
                count: count(50),
                offset: { type: 'integer', minimum: 0 },
            },
        },
        category: 'profiles',
        action: 'search_people',
        quota: { action: 'search_result', amount: args => Number(args.count) || 10 },
        clamp: { count: { default: 10, max: 50 } },
    },
    {
        name: 'send_invitation',
        description: 'Send a connection invitation, with an optional note (300 characters at most, 200 on a free LinkedIn account, which can only add a note a few times a month). Check with linkedin_pro_check_invitation first so nobody is invited twice.',
        inputSchema: { type: 'object', properties: { profile_url: profileUrl, message: { type: 'string', maxLength: 300, description: 'Optional personal note' } }, required: ['profile_url'] },
        category: 'network',
        action: 'invite',
        quota: { action: 'invitation' },
    },
    {
        name: 'check_invitation',
        description: 'Whether the user is already connected to someone, or an invitation is pending in either direction.',
        inputSchema: { type: 'object', properties: { profile_url: profileUrl }, required: ['profile_url'] },
        category: 'network',
        action: 'check_invitation',
    },
    {
        name: 'withdraw_invitation',
        description: 'Withdraw a pending invitation the user sent, by its invitation_id (keep it as a string).',
        inputSchema: { type: 'object', properties: { invitation_id: { type: 'string' } }, required: ['invitation_id'] },
        category: 'network',
        action: 'withdraw',
    },
    {
        name: 'list_received_invitations',
        description: 'Invitations the user received and has not answered yet.',
        inputSchema: { type: 'object', properties: { count: count(100), offset: { type: 'integer', minimum: 0 } } },
        category: 'network',
        action: 'list_invitations',
        clamp: { count: { default: 20, max: 100 } },
    },
    {
        name: 'accept_invitation',
        description: 'Accept a received invitation, with the entity_urn and shared_secret from linkedin_pro_list_received_invitations.',
        inputSchema: { type: 'object', properties: { entity_urn: { type: 'string' }, shared_secret: { type: 'string' } }, required: ['entity_urn', 'shared_secret'] },
        category: 'network',
        action: 'accept',
    },
    {
        name: 'list_sent_invitations',
        description: 'Invitations the user sent that are still pending.',
        inputSchema: { type: 'object', properties: { count: count(100), offset: { type: 'integer', minimum: 0 } } },
        category: 'network',
        action: 'list_sent',
        clamp: { count: { default: 20, max: 100 } },
    },
    {
        name: 'send_message',
        description: 'Send a LinkedIn message to someone the user is connected to. Read the conversation with linkedin_pro_get_conversation first, and never send the same message twice.',
        inputSchema: { type: 'object', properties: { profile_url: profileUrl, message_text: { type: 'string' } }, required: ['profile_url', 'message_text'] },
        category: 'messages',
        action: 'send',
        quota: { action: 'message' },
    },
    {
        name: 'list_conversations',
        description: "The user's LinkedIn inbox, most recent first. Pass next_cursor from the last answer to go further back.",
        inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['INBOX', 'UNREAD', 'MY_CONNECTIONS', 'INMAIL', 'STARRED'] }, count: count(50), cursor: { type: 'string' } } },
        category: 'messages',
        action: 'list_inbox',
        clamp: { count: { default: 20, max: 50 } },
    },
    {
        name: 'get_conversation',
        description: 'The messages of one conversation, most recent first, by conversation_id or by the other person’s profile_url. A message from the user carries their own profile URL as sender. To open a file in a message, pass its download_url to linkedin_pro_download_attachment: its `url` is LinkedIn’s private link and does not open.',
        inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, profile_url: profileUrl, count: count(50), cursor: { type: 'string' } } },
        category: 'messages',
        action: 'get_conversation',
        clamp: { count: { default: 20, max: 50 } },
    },
    {
        name: 'react_to_post',
        description: 'React to a LinkedIn post as the user.',
        inputSchema: { type: 'object', properties: { post_url: { type: 'string' }, reaction_type: { type: 'string', enum: ['LIKE', 'CELEBRATE', 'SUPPORT', 'FUNNY', 'LOVE', 'INSIGHTFUL'] } }, required: ['post_url'] },
        category: 'content',
        action: 'react',
        quota: { action: 'engagement' },
    },
    {
        name: 'comment_on_post',
        description: 'Comment on a LinkedIn post as the user.',
        inputSchema: { type: 'object', properties: { post_url: { type: 'string' }, comment_text: { type: 'string' } }, required: ['post_url', 'comment_text'] },
        category: 'content',
        action: 'comment',
        quota: { action: 'engagement' },
    },
    {
        name: 'create_post',
        description: "Publish a text post on the user's LinkedIn feed. Only when the user asked for it or approved the text.",
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        category: 'content',
        action: 'create',
        quota: { action: 'post' },
    },
    attachmentTool('attachment_download'),
]

export function linkedinTool(name: string): LinkedinTool | undefined {
    return LINKEDIN_TOOLS.find(tool => tool.name === name)
}
