import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkupError, runAction } from '@/lib/apps/linkup/client'
import { missingRequired, toolParams } from '@/lib/apps/tools'
import { WHATSAPP_TOOLS, isNewConversation } from './tools'

vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runAction: vi.fn() }))

const tool = (name: string) => WHATSAPP_TOOLS.find(candidate => candidate.name === name)!

describe('the WhatsApp tool set', () => {
    it('never hands the coworker the account itself: no login, no checkpoint, no account deletion, no webhook', () => {
        for (const candidate of WHATSAPP_TOOLS) expect(candidate.action).not.toMatch(/login|checkpoint|account|webhook/)
        expect(new Set(WHATSAPP_TOOLS.map(candidate => candidate.name)).size).toBe(WHATSAPP_TOOLS.length)
    })

    it('meters every message, and a first one twice', () => {
        expect(tool('send_message').quota?.action).toBe('message')
        expect(tool('send_message').extraQuota).toBe(isNewConversation)
    })

    it('keeps only the declared parameters and needs a number to write to', () => {
        const send = tool('send_message')
        expect(toolParams(send, { phone_number: '+33612345678', message_text: 'Hi', account_id: 'someone-else' })).toEqual({ phone_number: '+33612345678', message_text: 'Hi' })
        expect(missingRequired(send, toolParams(send, { message_text: 'Hi' }))).toEqual(['phone_number'])
    })

    it('posts a Status through Linkup content, unmetered, with only its own parameters', () => {
        const post = tool('post_status')
        expect([post.category, post.action, post.quota]).toEqual(['content', 'create', undefined])
        expect(toolParams(post, { message: 'Open today', background_color: '#25D366', font: 0, account_id: 'someone-else' })).toEqual({
            message: 'Open today',
            background_color: '#25D366',
            font: 0,
        })
        expect(missingRequired(post, toolParams(post, { file: 'https://example.com/promo.jpg' }))).toEqual([])
    })

    it('lists the chats and reads a group by its conversation_id', () => {
        expect(tool('list_conversations').action).toBe('list_inbox')
        expect(toolParams(tool('list_conversations'), {})).toEqual({ count: 20 })
        const read = tool('get_conversation')
        expect(missingRequired(read, toolParams(read, { conversation_id: '120363431168837418@g.us' }))).toEqual([])
    })
})

describe('managing chats and groups', () => {
    beforeEach(() => {
        vi.mocked(runAction).mockReset()
    })

    it('meters a forward like a message, and as a new conversation only toward a number', async () => {
        const forward = tool('forward_message')
        expect(forward.quota?.action).toBe('message')
        await expect(forward.extraQuota!('acc', { message_id: 'm1', conversation_id: '120363431168837418@g.us' })).resolves.toBeNull()
        expect(runAction).not.toHaveBeenCalled()
        vi.mocked(runAction).mockResolvedValue({ total_message_count: 0, messages: [] })
        await expect(forward.extraQuota!('acc', { message_id: 'm1', phone_number: '+33612345678' })).resolves.toBe('new_conversation')
    })

    it('counts a new group, and people added to one, as a new conversation', async () => {
        expect(tool('create_group').quota?.action).toBe('new_conversation')
        const participants = tool('update_group_participants')
        await expect(participants.extraQuota!('acc', { operation: 'add' })).resolves.toBe('new_conversation')
        await expect(participants.extraQuota!('acc', { operation: 'remove' })).resolves.toBeNull()
        expect(missingRequired(participants, toolParams(participants, { conversation_id: 'g@g.us', participants: ['+33612345678'] }))).toEqual(['operation'])
    })

    it('edits, deletes and reacts to messages, and tidies the chat list', () => {
        expect(['react_to_message', 'edit_message', 'delete_message', 'archive_conversation', 'delete_conversation', 'leave_group'].map(name => tool(name).action)).toEqual([
            'react_message',
            'edit_message',
            'delete_message',
            'archive_conversation',
            'delete_conversation',
            'leave_group',
        ])
    })

    it('reads the profile of a contact by number and the archived chats', () => {
        const profile = tool('get_contact_profile')
        expect([profile.category, profile.action]).toEqual(['profiles', 'get'])
        expect(toolParams(tool('list_conversations'), { archived: true })).toEqual({ archived: true, count: 20 })
    })
})

describe('isNewConversation', () => {
    beforeEach(() => {
        vi.mocked(runAction).mockReset()
    })

    it('counts a number with history as a reply', async () => {
        vi.mocked(runAction).mockResolvedValue({ total_message_count: 12, messages: [{}] })
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBeNull()
    })

    it('counts an empty chat, or one Linkup has never seen, as a new conversation', async () => {
        vi.mocked(runAction).mockResolvedValue({ total_message_count: 0, messages: [] })
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBe('new_conversation')
        vi.mocked(runAction).mockRejectedValue(new LinkupError('CHANNEL_ERROR', 'CHAT_NOT_FOUND', 422))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).resolves.toBe('new_conversation')
    })

    it('lets a signed-out account fail the call', async () => {
        vi.mocked(runAction).mockRejectedValue(new LinkupError('ACCOUNT_INACTIVE', 'NOT_CONNECTED', 401))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).rejects.toThrow('NOT_CONNECTED')
    })

    it('lets a closed linked device fail the call instead of counting a new conversation', async () => {
        vi.mocked(runAction).mockRejectedValue(new LinkupError('CHANNEL_ERROR', 'Connection Closed', 400))
        await expect(isNewConversation('acc', { phone_number: '+33612345678' })).rejects.toThrow('Connection Closed')
    })
})
